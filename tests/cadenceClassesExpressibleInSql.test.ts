/** @jest-environment node */
// #58: dueWhere() splits on `type = 'Gerrit'` vs everything else, because that is the
// only cadence distinction ContextUrl.type can carry. Adding a third key to
// CADENCE_HOURS would READ as scheduling that kind differently while silently giving it
// the web cadence — the query has no column that can tell it apart. This fails that edit
// at the point it is made rather than at the incident (AGENTS lesson 2).
//
// A source scan, not a DB test: the invariant is about what the code declares.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/refresh.ts'), 'utf8');
const literal = source.match(/const CADENCE_HOURS[^=]*=\s*\{([^}]*)\}/);

describe('the cadence table stays expressible in SQL (#58)', () => {
  it('still finds the CADENCE_HOURS literal — the scan below is worthless if it does not', () => {
    expect(literal).not.toBeNull();
  });

  it('declares exactly the two classes the due-source query can distinguish', () => {
    const keys = [...literal![1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
    // A third class needs a column dueWhere() can filter on before it can be scheduled.
    expect(keys).toEqual(['tracker', 'web']);
  });
});
