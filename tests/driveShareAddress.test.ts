/** @jest-environment node */
// The Drive SHARE address is a Workspace group Terraform creates — `autoknow@<domain>`,
// with the runtime service account as a member — and it is the only address the Sources
// page may present as "share with this". The service account the app AUTHENTICATES as is
// a different fact.
//
// They were once one function, `serviceAccountEmail()`, falling through
// GOOGLE_SHARE_ADDRESS → client_email → GOOGLE_SA_EMAIL. On any deployment without the
// infra variable that printed a raw *.iam.gserviceaccount.com address inside a sentence
// calling it the address to share with — authoritative-sounding, and not what the
// infrastructure established. These tests pin both halves of the contract: the app's
// resolution, and the Terraform wiring that feeds it.
import { readFileSync } from 'fs';
import path from 'path';

jest.mock('server-only', () => ({}));

const SA_KEY = JSON.stringify({
  client_email: 'autoknow@autoknow-alwaysmap.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
});

/** googleAuth reads the key ONCE at import time (`const key = loadKey()`), so each case
 *  needs a fresh module registry — the same import-time-capture that made
 *  tests/no-live-gemini.ts a `setupFiles` guard rather than a per-file line. */
// GOOGLE_APPLICATION_CREDENTIALS is in this list because next/jest loads the developer's
// real .env before any test runs: leave it set and `loadKey()` reads an actual key file
// off disk, so the "no key configured" cases silently test the configured branch on a
// developer machine and the intended one only in CI. Same trap as tests/no-live-gemini.ts.
const ENV_KEYS = [
  'GOOGLE_SHARE_ADDRESS',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_SA_EMAIL',
  'K_SERVICE',
] as const;

async function loadWith(env: Record<string, string | undefined>) {
  jest.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/lib/googleAuth');
}

describe('the Drive share address is the Workspace group, never the raw service account', () => {
  it('reports the group Terraform configured', async () => {
    const { driveShareAddress } = await loadWith({ GOOGLE_SHARE_ADDRESS: 'autoknow@alwaysmap.com' });
    expect(driveShareAddress()).toBe('autoknow@alwaysmap.com');
  });

  it('does NOT fall back to the service-account key when no group is configured', async () => {
    // The regression: this used to return the client_email, which the Sources page then
    // rendered as the address to share with.
    const { driveShareAddress, serviceAccountIdentity } = await loadWith({
      GOOGLE_SERVICE_ACCOUNT_JSON: SA_KEY,
    });
    expect(driveShareAddress()).toBeNull();
    expect(serviceAccountIdentity()).toBe('autoknow@autoknow-alwaysmap.iam.gserviceaccount.com');
  });

  it('does NOT fall back to GOOGLE_SA_EMAIL either (the keyless Cloud Run identity)', async () => {
    const { driveShareAddress, serviceAccountIdentity } = await loadWith({
      GOOGLE_SA_EMAIL: 'autoknow-run@autoknow-prod-1895f1.iam.gserviceaccount.com',
    });
    expect(driveShareAddress()).toBeNull();
    expect(serviceAccountIdentity()).toBe('autoknow-run@autoknow-prod-1895f1.iam.gserviceaccount.com');
  });

  it('the group wins even when a key is present — both facts are true at once', async () => {
    const { driveShareAddress, serviceAccountIdentity } = await loadWith({
      GOOGLE_SHARE_ADDRESS: 'autoknow@alwaysmap.com',
      GOOGLE_SERVICE_ACCOUNT_JSON: SA_KEY,
    });
    expect(driveShareAddress()).toBe('autoknow@alwaysmap.com');
    expect(serviceAccountIdentity()).toBe('autoknow@autoknow-alwaysmap.iam.gserviceaccount.com');
  });

  it('treats an empty or whitespace variable as unset, not as an address', async () => {
    // Terraform placeholders and blanked e2e env land here; rendering "share with  " is
    // the same lie in a quieter font.
    expect((await loadWith({ GOOGLE_SHARE_ADDRESS: '' })).driveShareAddress()).toBeNull();
    expect((await loadWith({ GOOGLE_SHARE_ADDRESS: '   ' })).driveShareAddress()).toBeNull();
  });
});

// The app half is only correct if infra actually supplies the variable. This reads the
// Terraform rather than trusting a comment: delete the env block, rename the group, or
// point the group at a different local part, and one of these fails.
describe('Terraform wires that group to GOOGLE_SHARE_ADDRESS', () => {
  const tf = readFileSync(path.join(__dirname, '..', 'infra', 'terraform', 'main.tf'), 'utf8');

  it('creates the share group as autoknow@<allowed_domain>', () => {
    expect(tf).toMatch(/resource\s+"google_cloud_identity_group"\s+"share"/);
    expect(tf).toMatch(/id\s*=\s*"autoknow@\$\{var\.allowed_domain\}"/);
  });

  it('puts the runtime service account IN the group — that is what makes sharing work', () => {
    expect(tf).toMatch(/resource\s+"google_cloud_identity_group_membership"\s+"share_sa"/);
    expect(tf).toMatch(/group\s*=\s*google_cloud_identity_group\.share\.id/);
    expect(tf).toMatch(/id\s*=\s*google_service_account\.run\.email/);
  });

  it('sets GOOGLE_SHARE_ADDRESS on Cloud Run from that group, not from the SA email', () => {
    const block = tf.match(/name\s*=\s*"GOOGLE_SHARE_ADDRESS"\s*\n\s*value\s*=\s*([^\n]+)/);
    expect(block).not.toBeNull();
    expect((block as RegExpMatchArray)[1].trim()).toBe(
      'google_cloud_identity_group.share.group_key[0].id',
    );
  });
});
