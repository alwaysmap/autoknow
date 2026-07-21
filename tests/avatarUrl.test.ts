import { allowedAvatarUrl } from '../src/lib/avatar';

// /api/me/avatar fetches whatever URL this returns, so this allowlist is the only
// thing standing between a profile-photo feature and a server-side request forgery.
// The rejection cases matter more than the acceptance ones.

const REAL = 'https://lh3.googleusercontent.com/a/ACg8ocK7=s96-c';

describe('allowedAvatarUrl', () => {
  it('accepts the Google photo hosts', () => {
    expect(allowedAvatarUrl(REAL)?.href).toBe(REAL);
    // Workspace avatars come from lh3–lh6 depending on the shard.
    for (const h of ['lh3', 'lh4', 'lh5', 'lh6']) {
      expect(allowedAvatarUrl(`https://${h}.googleusercontent.com/a/x`)).not.toBeNull();
    }
    expect(allowedAvatarUrl('https://googleusercontent.com/a/x')).not.toBeNull();
  });

  it('rejects lookalike hosts that merely END with the domain', () => {
    expect(allowedAvatarUrl('https://evilgoogleusercontent.com/a/x')).toBeNull();
    expect(allowedAvatarUrl('https://googleusercontent.com.evil.test/a/x')).toBeNull();
    expect(allowedAvatarUrl('https://evil.test/lh3.googleusercontent.com/a/x')).toBeNull();
  });

  it('rejects credentials-in-host and other authority tricks', () => {
    // The host here is evil.test — the googleusercontent part is a userinfo field.
    expect(allowedAvatarUrl('https://lh3.googleusercontent.com@evil.test/x')).toBeNull();
  });

  it('rejects non-https schemes, including the SSRF-classic ones', () => {
    expect(allowedAvatarUrl('http://lh3.googleusercontent.com/a/x')).toBeNull();
    expect(allowedAvatarUrl('file:///etc/passwd')).toBeNull();
    expect(allowedAvatarUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(allowedAvatarUrl('gopher://lh3.googleusercontent.com/x')).toBeNull();
  });

  it('rejects internal targets', () => {
    expect(allowedAvatarUrl('https://169.254.169.254/computeMetadata/v1/')).toBeNull();
    expect(allowedAvatarUrl('https://localhost/x')).toBeNull();
    expect(allowedAvatarUrl('https://10.0.0.1/x')).toBeNull();
  });

  it('is null — not a throw — for absent or unparseable input', () => {
    expect(allowedAvatarUrl(null)).toBeNull();
    expect(allowedAvatarUrl(undefined)).toBeNull();
    expect(allowedAvatarUrl('')).toBeNull();
    expect(allowedAvatarUrl('not a url')).toBeNull();
    expect(allowedAvatarUrl('/relative/path')).toBeNull();
  });

  it('is case-insensitive about the host, as DNS is', () => {
    expect(allowedAvatarUrl('https://LH3.GoogleUserContent.COM/a/x')).not.toBeNull();
  });

  // Not security — product judgement, pinned so nobody "fixes" it back.
  it('treats Google’s no-photo silhouette as no photo, so initials win', () => {
    expect(allowedAvatarUrl('https://lh3.googleusercontent.com/a/default-user=s96-c')).toBeNull();
    expect(allowedAvatarUrl('https://lh3.googleusercontent.com/a-/default-user')).toBeNull();
    // A real photo whose opaque id merely resembles it is still a real photo.
    expect(allowedAvatarUrl('https://lh3.googleusercontent.com/a/ACg8ocKdefault')).not.toBeNull();
  });
});
