import { test, expect } from '../helpers/e2e';
import { prisma } from '../helpers/db';
import { wipeAll } from '../helpers/fixtures';

// The zod gate (lib/schemas) on the JSON mutation APIs: malformed payloads are
// refused with a 400 and a readable message — never a 500, never a silently
// half-valid row. Mirrors the schema-level invariants (required region, notes).

test.describe('API input validation', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;

  test.beforeAll(async () => {
    await wipeAll();
    const partner = await prisma.partner.create({
      data: {
        name: 'Volvo Cars',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
      },
    });
    partnerId = partner.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('partners: region is required and must exist', async ({ request }) => {
    // Missing region → 400 naming the field.
    let res = await request.post('/api/partners', { data: { name: 'Scania', type: 'OEM' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('region');

    // Unknown region name → 400, not a silently region-less partner.
    res = await request.post('/api/partners', { data: { name: 'Scania', type: 'OEM', region: 'Atlantis' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Atlantis');

    // Bad website URL → 400.
    res = await request.post('/api/partners', {
      data: { name: 'Scania', type: 'OEM', region: 'EMEA', website: 'not a url' },
    });
    expect(res.status()).toBe(400);

    // Valid payload → 201 with the region attached.
    res = await request.post('/api/partners', { data: { name: 'Scania', type: 'OEM', region: 'EMEA' } });
    expect(res.status()).toBe(201);
    const { partner } = await res.json();
    expect(partner.regionId).toBeTruthy();
  });

  test('people: email must be an email, partner id must be numeric', async ({ request }) => {
    let res = await request.post('/api/people', {
      data: { name: 'Åsa Lindqvist', email: 'not-an-email', currentPartnerId: partnerId },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('email');

    res = await request.post('/api/people', {
      data: { name: 'Åsa Lindqvist', email: 'asa@volvocars.com', currentPartnerId: 'abc' },
    });
    expect(res.status()).toBe(400);

    res = await request.post('/api/people', {
      data: { name: 'Åsa Lindqvist', email: 'asa@volvocars.com', currentPartnerId: partnerId },
    });
    expect(res.status()).toBe(201);
  });

  test('projects: name and numeric partnerId are required; junk numbers are refused', async ({ request }) => {
    let res = await request.post('/api/projects', { data: { partnerId } });
    expect(res.status()).toBe(400);

    res = await request.post('/api/projects', {
      data: { name: 'EX90 Refresh', partnerId, volumeFirstYear: -5 },
    });
    expect(res.status()).toBe(400);

    res = await request.post('/api/projects', {
      data: { name: 'EX90 Refresh', partnerId, volumeFirstYear: 120000 },
    });
    expect(res.status()).toBe(201);
  });
});
