'use client';

import type { FeedKind } from '../lib/feed';
import { t, type Locale, type StringKey } from '../lib/i18n';
import styles from './KindBox.module.css';

// What a result IS, as a boxed readout. One implementation for both search
// surfaces — the suggestion dropdown and the full result list — so the two can't
// drift apart on either the wording or the colour.
//
// Identity, never health: these say "this row is a Program", not "this program is
// fine". The inks are tokens because the hexes they replace were chosen against a
// light page and fell to 1.7:1 on the dark themes, which made the label
// unreadable. The BOX matters as much as the colour — it means the label no
// longer depends on colour alone to separate itself from the title beside it.

const KIND_KEY: Record<FeedKind, StringKey> = {
  partner: 'partnerLabel',
  program: 'programLabel',
  person: 'personLabel',
  context: 'contextLabel',
  status: 'statusLabel',
  phase: 'phaseLabel',
  relationship: 'partnerLabel',
  'program-created': 'feedCatCreated',
};

export const KIND_COLOR: Record<FeedKind, string> = {
  partner: 'var(--kind-partner)',
  program: 'var(--kind-program)',
  person: 'var(--kind-person)',
  context: 'var(--kind-context)',
  status: 'var(--kind-program)',
  phase: 'var(--kind-partner)',
  relationship: 'var(--kind-person)',
  'program-created': 'var(--kind-partner)',
};

export default function KindBox({ kind, locale }: { kind: FeedKind; locale: Locale }) {
  return (
    <span className={styles.box} style={{ color: KIND_COLOR[kind] }}>
      {t(locale, KIND_KEY[kind])}
    </span>
  );
}
