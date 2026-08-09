// Which Google products a PARTNER carries — the union of the product booleans across
// its programs (gh-286 part f: the bulk-add table's Products column). Pure and
// client-safe; the prisma loader that feeds it lives in lib/initiativeQueries.
//
// Deliberately NOT lib/sop's PRODUCT_KEYS: that list carries 'aaos', the base
// platform every program has, which as a per-partner class token would decorate
// every row identically and distinguish nothing. The four keys here are sop's
// spellings (so the two vocabularies stay one), in this module's own canonical
// order; sop's `productCarried` predicates are likewise restated below rather
// than reused, because they take `CapacityProgram` — sopDate and volume are
// required there, and a bare flags row has neither.

import { t, type Locale, type StringKey } from './i18n';

export const PARTNER_PRODUCT_KEYS = ['gas', 'gbi', 'digitalKey', 'aap'] as const;
export type PartnerProductKey = (typeof PARTNER_PRODUCT_KEYS)[number];

/** The product booleans as they sit on `Project` — the loader selects exactly these. */
export interface ProductFlags {
  hasGas: boolean;
  hasGbi: boolean;
  hasDigitalKey: boolean;
  hasAap: boolean;
}

const carried: Record<PartnerProductKey, (p: ProductFlags) => boolean> = {
  gas: (p) => p.hasGas,
  gbi: (p) => p.hasGbi,
  digitalKey: (p) => p.hasDigitalKey,
  aap: (p) => p.hasAap,
};

/** The products at least one of `programs` carries, in canonical key order. */
export function productUnion(programs: ProductFlags[]): PartnerProductKey[] {
  return PARTNER_PRODUCT_KEYS.filter((k) => programs.some((p) => carried[k](p)));
}

/** Full product names (the program-form vocabulary) — funnel/hover expansion. */
export const PRODUCT_NAME_KEY: Record<PartnerProductKey, StringKey> = {
  gas: 'productGas',
  gbi: 'productGbi',
  digitalKey: 'productDigitalKey',
  aap: 'productAap',
};

/** The short reading a table cell has room for. Acronyms are locale-invariant
 *  (ProjectMetaHeader's precedent: 'GAS'/'GBI'/'AAP' as-is); Digital Key is the one
 *  with a translated name, so it reads through its i18n key. */
export function productShortLabel(locale: Locale, k: PartnerProductKey): string {
  if (k === 'digitalKey') return t(locale, 'productDigitalKey');
  return { gas: 'GAS', gbi: 'GBI', aap: 'AAP' }[k];
}
