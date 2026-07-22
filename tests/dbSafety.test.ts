/** @jest-environment node */
// The destructive-op guard must FAIL CLOSED: a wipe is refused unless the resolved
// DATABASE_URL names a disposable test database, or the operator has explicitly named
// this exact database in DESTRUCTIVE_DB_ALLOWED. A misconfigured DATABASE_URL (the
// realistic accident) can never match a confirmation meant for a different database.
import { assertDestructiveDbAllowed, destructiveDbAllowed, resolveDbName } from '../src/lib/dbSafety';

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

describe('resolveDbName', () => {
  it('extracts the database name from a connection URL', () => {
    expect(resolveDbName('postgresql://u:p@host:5432/autoknow')).toBe('autoknow');
    expect(resolveDbName('postgresql://u:p@host:5432/autoknow_test?sslmode=require')).toBe('autoknow_test');
  });
});

describe('assertDestructiveDbAllowed', () => {
  it('always allows a *_test database (disposable)', () => {
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_test', DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(() => assertDestructiveDbAllowed('wipe')).not.toThrow();
    });
  });

  it('refuses a non-test database when no confirmation is set — regardless of NODE_ENV', () => {
    withEnv(
      { DATABASE_URL: 'postgresql://u:p@h:5432/autoknow', DESTRUCTIVE_DB_ALLOWED: undefined, NODE_ENV: 'development' },
      () => {
        expect(() => assertDestructiveDbAllowed('wipe')).toThrow(/DESTRUCTIVE_DB_ALLOWED/);
      },
    );
  });

  it('allows when the confirmation names the EXACT resolved database', () => {
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow', DESTRUCTIVE_DB_ALLOWED: 'autoknow' }, () => {
      expect(() => assertDestructiveDbAllowed('wipe')).not.toThrow();
    });
  });

  it('refuses when the confirmation names a DIFFERENT database (the misconfiguration case)', () => {
    // .env still confirms the demo db, but DATABASE_URL was fat-fingered to prod.
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_prod', DESTRUCTIVE_DB_ALLOWED: 'autoknow_demo' }, () => {
      expect(() => assertDestructiveDbAllowed('wipe')).toThrow(/autoknow_prod/);
    });
  });

  it('refuses when DATABASE_URL is missing entirely', () => {
    withEnv({ DATABASE_URL: undefined, DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(() => assertDestructiveDbAllowed('wipe')).toThrow();
    });
  });
});

describe('destructiveDbAllowed (non-throwing predicate — gates the seed-time timestamp override)', () => {
  it('mirrors the assert: test DB and exact confirmation allow, everything else refuses', () => {
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_test', DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(destructiveDbAllowed()).toBe(true);
    });
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow', DESTRUCTIVE_DB_ALLOWED: 'autoknow' }, () => {
      expect(destructiveDbAllowed()).toBe(true);
    });
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow', DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(destructiveDbAllowed()).toBe(false);
    });
    withEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_prod', DESTRUCTIVE_DB_ALLOWED: 'autoknow_demo' }, () => {
      expect(destructiveDbAllowed()).toBe(false);
    });
  });

  it('fails closed on missing or malformed DATABASE_URL', () => {
    withEnv({ DATABASE_URL: undefined, DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(destructiveDbAllowed()).toBe(false);
    });
    withEnv({ DATABASE_URL: 'not a url', DESTRUCTIVE_DB_ALLOWED: undefined }, () => {
      expect(destructiveDbAllowed()).toBe(false);
    });
  });
});
