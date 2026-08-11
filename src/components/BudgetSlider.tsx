'use client';

import { useState, useTransition } from 'react';
import { budgetGauge } from '../lib/ingestBudget';
import { updateIngestionBudgetAction } from '../app/actions/ingestion';
import styles from './IngestionHealthCard.module.css';

// #38: the free-tier budget knob. The admin sets ONE number — documents (re)ingested per
// day — and the scale shows, live, where that lands against the Gemini free-tier request
// ceiling (itself editable, because Google changes the numbers). All the math is the pure
// budgetGauge() the cron also enforces (tests/ingestBudget.test.ts), so what the user sees
// is exactly what will be spent. Cost-to-zero is preserved: the budget only spends on
// documents that actually changed.
//
// `cyclesPerDay` is a PROP, not a default, and that is the whole point of #197: the
// Scheduler cadence arrives as a server-side env var, which does not exist in the browser
// bundle. Letting this component fall back to the default would put the gauge back on an
// assumed cadence while the cron enforces the real one — the same divergence between the
// plotted ceiling and the spent one that this change exists to close, only now in the
// half a human actually reads.

export interface BudgetSliderLabels {
  help: string;
  sliderLabel: string;
  docsUnit: string;
  requestsUnit: string;
  freeTierMarker: string;
  safeTag: string;
  overTag: string;
  freeTierLabel: string;
  save: string;
  saving: string;
  saved: string;
  verify: string;
}

export default function BudgetSlider({
  initialBudgetDocs,
  initialFreeTierRpd,
  cyclesPerDay,
  labels,
}: {
  initialBudgetDocs: number;
  initialFreeTierRpd: number;
  cyclesPerDay: number;
  labels: BudgetSliderLabels;
}) {
  const [budget, setBudget] = useState(initialBudgetDocs);
  const [freeTier, setFreeTier] = useState(initialFreeTierRpd);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const gauge = budgetGauge(budget, freeTier, cyclesPerDay);
  // Slider max keeps the free-tier line roughly mid-scale so the safe/over split is legible.
  const maxDocs = Math.max(10, gauge.safeMaxDocsPerDay * 2, budget);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / maxDocs) * 100))}%`;

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      await updateIngestionBudgetAction(formData);
      setSaved(true);
    });
  }

  return (
    <form action={onSubmit}>
      <p className={styles.help}>{labels.help}</p>

      <label data-eyebrow htmlFor="ingest-budget">
        {labels.sliderLabel}
      </label>
      <input
        id="ingest-budget"
        className={styles.range}
        type="range"
        name="dailyReingestBudgetDocs"
        min={0}
        max={maxDocs}
        step={1}
        value={budget}
        onChange={(e) => {
          setBudget(Number(e.target.value));
          setSaved(false);
        }}
      />

      {/* the scale: safe zone, an over-the-free-tier zone, the current fill, and the line */}
      <div className={styles.scale} aria-hidden="true">
        <div className={styles.overZone} style={{ left: pct(gauge.safeMaxDocsPerDay) }} />
        <div
          className={`${styles.fill} ${gauge.exceedsFreeTier ? styles.fillOver : ''}`}
          style={{ width: pct(budget) }}
        />
        <div className={styles.marker} style={{ left: pct(gauge.safeMaxDocsPerDay) }} />
        <span className={styles.markerLabel} style={{ left: pct(gauge.safeMaxDocsPerDay) }}>
          {labels.freeTierMarker}
        </span>
      </div>

      <p className={styles.readout} data-testid="budget-readout">
        <strong>{budget}</strong> {labels.docsUnit} ≈ <strong>{gauge.requestsPerDay}</strong>{' '}
        {labels.requestsUnit} —{' '}
        {gauge.exceedsFreeTier ? (
          <span className={styles.overTag} data-testid="over-free-tier">{labels.overTag}</span>
        ) : (
          <span className={styles.safeTag}>{labels.safeTag}</span>
        )}
      </p>

      <label className={styles.freeTierField}>
        {labels.freeTierLabel}
        <input
          className={styles.freeTierInput}
          type="number"
          name="freeTierRequestsPerDay"
          min={0}
          value={freeTier}
          onChange={(e) => {
            setFreeTier(Number(e.target.value));
            setSaved(false);
          }}
        />
      </label>

      <div className={styles.controls}>
        <button className={styles.save} type="submit" disabled={pending}>
          {pending ? labels.saving : labels.save}
        </button>
        {saved && !pending && (
          <span className={styles.saved} data-testid="budget-saved">{labels.saved}</span>
        )}
      </div>

      <p className={styles.verify}>{labels.verify}</p>
    </form>
  );
}
