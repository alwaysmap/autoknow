# ---- Ingestion drain alarm (issue #38) ----
# The evidence instrument the scaling ADR asks for: it tells us WHEN ingestion has
# outgrown the "hundreds"-sized design, from data rather than intuition.
# ADR: docs/adr/2026-07-23-ingestion-health-is-a-serverless-signal-not-a-growing-table.md (§2).
#
# Serverless + cost-to-zero-when-idle by construction: this is a Cloud Monitoring alert
# over a LOG-BASED METRIC computed on the hourly cron's structured log line. No database,
# no always-on service. Cloud Logging is the canonical time-series store (retention-bounded,
# ~free at this volume); we only extract a metric and alert on it.
#
# The signal (emitted once per hourly cron cycle by src/lib/ingestionHealth.ts as a
# `console.log(JSON.stringify(...))`, which Cloud Run turns into a Logging jsonPayload):
#   { "message": "ingestion.cycle",
#     "severity": "INFO|WARNING|ERROR",
#     "ingestionCycle": { "backlog": <int>, "quotaStopped": <bool>, "drive": {...}, "web": {...} } }
# `backlog` = docs that were due/discoverable this cycle but exceeded the per-cycle budget
# and carried over. Sustained backlog > 0 across cycles ⇒ ingestion is not keeping up.
#
# GATING / honest degrade (AGENTS lesson 5, infra-terraform skill): the whole alarm is
# off by default. It only exists when the operator opts in AND supplies a destination
# address, so the app never depends on a half-configured alarm. Enabling without an email
# fails LOUDLY at plan time (precondition below) rather than silently creating a dead alarm.
# All resources share the same `count` gate so the feature is atomic — all of it or none.

# ---- Email notification channel ----
resource "google_monitoring_notification_channel" "ingestion_email" {
  count        = var.enable_ingestion_alarm ? 1 : 0
  project      = google_project.autoknow.project_id
  display_name = "AutoKnow ingestion alerts"
  type         = "email"

  labels = {
    email_address = var.ingestion_alarm_email
  }

  # Honest failure instead of a silent no-op: turning the alarm on without a destination
  # is a misconfiguration, so surface it at plan/apply rather than creating a channel
  # that can never deliver.
  lifecycle {
    precondition {
      condition     = var.ingestion_alarm_email != ""
      error_message = "enable_ingestion_alarm = true requires ingestion_alarm_email to be a non-empty address."
    }
  }
}

# ---- Log-based metric: per-cycle backlog ----
# DISTRIBUTION metric whose value is EXTRACTed from the structured log. One data point per
# hourly cycle (the cron cadence). Filtered to the Cloud Run service's ingestion.cycle logs
# so nothing else can pollute it.
resource "google_logging_metric" "ingestion_backlog" {
  count   = var.enable_ingestion_alarm ? 1 : 0
  project = google_project.autoknow.project_id
  name    = "ingestion_backlog"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${var.service_name}"
    jsonPayload.message="ingestion.cycle"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "Ingestion backlog (docs carried over per cycle)"
  }

  # Pull the integer backlog out of the JSON payload.
  value_extractor = "EXTRACT(jsonPayload.ingestionCycle.backlog)"

  # Required for a DISTRIBUTION metric. Backlog is a small non-negative integer (bounded by
  # the per-cycle caps and the corpus), so a modest exponential histogram covers it cheaply.
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 16
      growth_factor      = 2
      scale              = 1
    }
  }
}

# ---- Log-based metric: quota-exhaustion cycles ----
# Simple COUNTER of cycles that halted on Gemini quota (`quotaStopped=true`). The ADR wants
# both backlog AND quota exhaustion visible: a backlog can mean "behind but draining", while
# a quota stop means we hit the ceiling the scaling ADR watches. When quota is never hit this
# metric simply has no data — it stays quiet, which is the correct/honest behaviour.
resource "google_logging_metric" "ingestion_quota_stopped" {
  count   = var.enable_ingestion_alarm ? 1 : 0
  project = google_project.autoknow.project_id
  name    = "ingestion_quota_stopped"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${var.service_name}"
    jsonPayload.message="ingestion.cycle"
    jsonPayload.ingestionCycle.quotaStopped=true
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Ingestion cycles halted by quota exhaustion"
  }
}

# ---- Alert policy: backlog not draining ----
# Fires when backlog stays ABOVE 0 for 3 consecutive hourly cycles.
# Reasoning for the 3-hour window: the cron is hourly, so a single cycle with backlog > 0 is
# routine (a burst of shared docs that the next cycle drains). What matters is a backlog that
# PERSISTS — that is the scaling ADR's "the simple design stopped fitting" trigger. 3 cycles
# filters transient spikes while still catching a real, sustained drain within a few hours.
# alignment_period = 1h matches the cadence (one aligned point per cycle); ALIGN_PERCENTILE_99
# reduces the per-window distribution to a scalar (with one sample/hour it equals that sample)
# — the percentile aligners are the ones valid for DISTRIBUTION-valued metrics.
resource "google_monitoring_alert_policy" "ingestion_backlog" {
  count        = var.enable_ingestion_alarm ? 1 : 0
  project      = google_project.autoknow.project_id
  display_name = "AutoKnow: ingestion backlog not draining"
  combiner     = "OR"

  conditions {
    display_name = "Backlog > 0 for 3 consecutive hourly cycles"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.ingestion_backlog[0].name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "10800s" # 3 hourly cycles

      aggregations {
        alignment_period   = "3600s" # one cron cycle
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.ingestion_email[0].id]

  documentation {
    content   = <<-EOT
      Ingestion backlog has stayed above zero for 3+ hourly cron cycles: documents are due
      for (re)ingestion faster than the per-cycle caps drain them.

      This is the drain alarm from issue #38 / the ingestion-health ADR (§2). It is the
      evidence trigger the scaling ADR asks for before touching throughput — investigate
      first (is this an onboarding cold-start that will clear, or steady-state overload?),
      do NOT reflexively raise the per-cycle caps (that trades a freshness backlog for
      Gemini quota-exhaustion errors). See docs/INGEST_FRESHNESS_PLAN.md and
      docs/adr/2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md.
    EOT
    mime_type = "text/markdown"
  }
}

# ---- Alert policy: quota exhaustion ----
# Fires the moment a cycle halts on quota. Distinct from backlog: quota exhaustion means we
# hit the Gemini ceiling this cycle, so even a single occurrence is worth surfacing
# immediately (duration 0s). Sparse by nature — no data when quota is never hit.
resource "google_monitoring_alert_policy" "ingestion_quota_stopped" {
  count        = var.enable_ingestion_alarm ? 1 : 0
  project      = google_project.autoknow.project_id
  display_name = "AutoKnow: ingestion halted by quota exhaustion"
  combiner     = "OR"

  conditions {
    display_name = "A cycle stopped on quota"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.ingestion_quota_stopped[0].name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s" # surface the first quota-stopped cycle

      aggregations {
        alignment_period   = "3600s" # one cron cycle
        per_series_aligner = "ALIGN_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.ingestion_email[0].id]

  documentation {
    content   = <<-EOT
      An ingestion cycle halted because a Gemini quota was exhausted. This is the hard
      ceiling the scaling ADR watches: throughput is now quota-bound, not cap-bound.
      See docs/adr/2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md.
    EOT
    mime_type = "text/markdown"
  }
}
