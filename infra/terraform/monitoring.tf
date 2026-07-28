# ---- Ingestion drain alarm (issue #38) ----
# The evidence instrument the scaling ADR asks for: it tells us WHEN ingestion has
# outgrown the "hundreds"-sized design, from data rather than intuition.
# ADR: docs/adr/2026-07-23-ingestion-health-is-a-serverless-signal-not-a-growing-table.md (§2).
#
# Serverless + cost-to-zero-when-idle by construction: this is a Cloud Monitoring alert
# over a LOG-BASED METRIC computed on the cron's structured log line. No database,
# no always-on service. Cloud Logging is the canonical time-series store (retention-bounded,
# ~free at this volume); we only extract a metric and alert on it.
#
# The signal (emitted once per cron cycle by src/lib/ingestionHealth.ts as a
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

# ---- The cadence, derived instead of restated ----
# These alarms are written in CYCLES ("backlog persisted for three cycles"), but Cloud
# Monitoring only speaks seconds, so the windows have to be a number. Writing that number
# by hand is how "3600s # one cron cycle" became a lie waiting for someone to change
# var.cron_schedule: at */30 the drain alarm's window is two cycles wide, so it fires on
# noise, and at a sparser schedule it sleeps through a real stall. That is the same
# assumption lib/cronCadence.ts removed from the app one layer up (#202), one layer down.
# ADR: docs/adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md.
#
# The parse deliberately mirrors src/lib/cronCadence.ts, including the part that is easy to
# get wrong: a field COUNTS its matches, it does not divide. `0 */5 * * *` fires at hours 0,
# 5, 10, 15 and 20 — five cycles a day, not the 4.8 that 24/5 suggests — and rounding that
# down would widen every window past the cadence it claims to track.
#
# Unrecognised shapes resolve to 0, which means UNKNOWN, not "assume hourly". The app can
# fall back to a documented default because a wrong divisor there only costs money in one
# direction; an alarm window guessed from a schedule nobody parsed is an alarm that lies
# about what it watches. A precondition on each policy turns that into a loud plan-time
# failure, exactly like the missing-email precondition below.
locals {
  # Cron fields, whitespace-normalised. Anything that is not the 5-field form is unknown.
  cron_fields          = compact(split(" ", replace(trimspace(var.cron_schedule), "/\\s+/", " ")))
  cron_has_five_fields = length(local.cron_fields) == 5

  # Day-of-month, month, day-of-week. Any narrowing there means "not a daily cadence", and
  # averaging such a schedule into cycles/day would report a fraction these windows cannot
  # honour. Named rather than sliced inline, so nothing here depends on counting positions.
  cron_date_fields = local.cron_has_five_fields ? slice(local.cron_fields, 2, 5) : []
  cron_is_daily    = local.cron_has_five_fields && alltrue([for f in local.cron_date_fields : f == "*"])

  # Not-5-field collapses to empty strings, which match none of the rules below and so land
  # on 0 = unknown — the same answer as a field shape we refuse to guess at.
  cron_field_values  = local.cron_has_five_fields ? { minute = local.cron_fields[0], hour = local.cron_fields[1] } : { minute = "", hour = "" }
  cron_field_domains = { minute = 60, hour = 24 }

  # Each field is read twice — once as a step, once as a value list — and `cron_field_counts`
  # below picks whichever one matched. `try`/`regexall` keep a non-match from erroring.
  # `*/n` → the step, else 0.
  cron_field_steps = { for f, v in local.cron_field_values : f => try(tonumber(regexall("^\\*/([0-9]+)$", v)[0][0]), 0) }
  # `7` or `0,12` → the values, else []. Anything else (ranges, names, `L`) stays unknown.
  cron_field_lists = { for f, v in local.cron_field_values : f => (
    length(regexall("^[0-9]+(?:,[0-9]+)*$", v)) > 0 ? [for x in split(",", v) : tonumber(x)] : []
  ) }

  # How many times a day each field matches — 0 for "unrecognised", which includes every
  # in-shape-but-out-of-range value (a step past the domain, an hour of 25).
  cron_field_counts = {
    for f, domain in local.cron_field_domains : f => (
      local.cron_field_values[f] == "*" ? domain :
      local.cron_field_steps[f] >= 1 && local.cron_field_steps[f] <= domain ? ceil(domain / local.cron_field_steps[f]) :
      length(local.cron_field_lists[f]) > 0 && alltrue([for v in local.cron_field_lists[f] : v < domain]) ?
      length(distinct(local.cron_field_lists[f])) :
      0
    )
  }

  # Cycles per day, or 0 for unknown. Bounded by 60 × 24, so the derived alignment period
  # can never fall below Cloud Monitoring's 60s minimum.
  cron_cycles_per_day = (
    local.cron_is_daily && local.cron_field_counts["minute"] > 0 && local.cron_field_counts["hour"] > 0
    ? local.cron_field_counts["minute"] * local.cron_field_counts["hour"]
    : 0
  )

  cron_cycle_seconds = local.cron_cycles_per_day > 0 ? floor(86400 / local.cron_cycles_per_day) : 0

  # How many cycles a backlog must persist for before it is a drain problem rather than a
  # burst. Declared once and interpolated into the window, the condition name and the
  # responder's documentation, so tuning it cannot leave a string behind saying otherwise —
  # which is the same mistake as restating the cadence, one size down.
  alarm_drain_cycles     = 3
  alarm_alignment_period = "${local.cron_cycle_seconds}s"
  alarm_drain_duration   = "${local.cron_cycle_seconds * local.alarm_drain_cycles}s"

  cron_unparsed_message = <<-EOT
    var.cron_schedule = "${var.cron_schedule}" is not a shape this config can turn into a
    cadence, so the ingestion alarm windows cannot be derived and would silently mean
    something other than "one cycle" / "${local.alarm_drain_cycles} cycles". Recognised: 5
    fields; minute and hour each `*`, `*/n`, a value, or a comma list, all in range for the
    field; day/month/weekday all `*` (matching src/lib/cronCadence.ts). Either use a schedule
    of that shape, or set enable_ingestion_alarm = false and reason about the windows by hand.
  EOT
}

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
# cycle (the cron cadence). Filtered to the Cloud Run service's ingestion.cycle logs
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
# Fires when backlog stays ABOVE 0 for local.alarm_drain_cycles consecutive cron cycles.
# Reasoning for that window: one cycle with backlog > 0 is routine (a burst of shared
# docs that the next cycle drains). What matters is a backlog that PERSISTS — that is the
# scaling ADR's "the simple design stopped fitting" trigger. Three cycles filters transient
# spikes while still catching a real, sustained drain quickly. Both windows are derived from
# var.cron_schedule by the locals above, so "one cycle" stays true when the schedule changes;
# at today's hourly default they are the 3600s / 10800s this policy has always used.
# ALIGN_PERCENTILE_99 reduces the per-window distribution to a scalar (with one sample per
# cycle it equals that sample) — the percentile aligners are the ones valid for
# DISTRIBUTION-valued metrics.
resource "google_monitoring_alert_policy" "ingestion_backlog" {
  count        = var.enable_ingestion_alarm ? 1 : 0
  project      = google_project.autoknow.project_id
  display_name = "AutoKnow: ingestion backlog not draining"
  combiner     = "OR"

  conditions {
    display_name = "Backlog > 0 for ${local.alarm_drain_cycles} consecutive cron cycles"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.ingestion_backlog[0].name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = local.alarm_drain_duration

      aggregations {
        alignment_period   = local.alarm_alignment_period
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }

      trigger {
        count = 1
      }
    }
  }

  # An alarm whose window cannot be derived is an alarm that does not mean what it says, so
  # fail at plan time rather than create one. Same shape as the notification channel's
  # precondition above: honest failure over a silent no-op.
  lifecycle {
    precondition {
      condition     = local.cron_cycles_per_day > 0
      error_message = local.cron_unparsed_message
    }
  }

  notification_channels = [google_monitoring_notification_channel.ingestion_email[0].id]

  documentation {
    content   = <<-EOT
      Ingestion backlog has stayed above zero for ${local.alarm_drain_cycles}+ consecutive cron cycles: documents are due
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
        alignment_period   = local.alarm_alignment_period
        per_series_aligner = "ALIGN_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  # Same precondition as the drain policy, for the same reason.
  lifecycle {
    precondition {
      condition     = local.cron_cycles_per_day > 0
      error_message = local.cron_unparsed_message
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
