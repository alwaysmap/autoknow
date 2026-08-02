/** @jest-environment node */
// Escalations in the activity feed (#245 section A). getActivity is the one function that
// decides what counts as "activity" across every scope; this pins the two events an
// escalation contributes (raised, closed) and the one exception (person scope emits raised
// only, because closing deliberately records no actor — see the block comment in
// lib/activity.ts for why).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { escalationHref } from '../src/lib/entityHref';

jest.mock('server-only', () => ({}));

type Activity = typeof import('../src/lib/activity');
let getActivity: Activity['getActivity'];

let partnerId: number;
let projectId: number;
let raiserPersonId: number;

beforeAll(async () => {
  ({ getActivity } = await import('../src/lib/activity'));
  await wipeAll();

  const partner = await prisma.partner.create({
    data: {
      name: 'Volvo Cars',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
    },
  });
  partnerId = partner.id;

  const project = await prisma.project.create({
    data: { name: 'Volvo EX90 AAOS Refresh', partnerId },
  });
  projectId = project.id;

  // The person the chat-raised escalation below is attributed to via `raisedBy` — a real
  // Person so `personAliases` has an address to match against.
  const raiser = await prisma.person.create({
    data: { name: 'Lena Fischer', email: 'lena@continental.example', currentPartnerId: partnerId },
  });
  raiserPersonId = raiser.id;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('an escalation contributes RAISED and CLOSED events, and only those two', () => {
  it('shows a raised event for an open, untriaged escalation', async () => {
    const e = await prisma.escalation.create({
      data: { title: 'Second-source codec decision needed', partnerId, projectId, sourceKind: 'manual' },
    });

    const items = await getActivity({ kind: 'ecosystem' });
    const raised = items.find((i) => i.id === `esc-raised-${e.id}`);
    expect(raised).toBeDefined();
    expect(raised!.kind).toBe('escalation');
    expect(raised!.title).toBe('Second-source codec decision needed');
    expect(raised!.href).toBe(escalationHref(e.id));
    expect(raised!.timestamp).toBe(e.createdAt.toISOString());
    // Always created open — the raised event states that, not any later status.
    expect(raised!.subtitle).toMatch(/^Open\b|·\s*Open\b|Open$/);
    // Untriaged: no severity token leaks into the subtitle as a stray "· ·".
    expect(raised!.subtitle).not.toMatch(/S1|S2|S3/);

    // No closed event for a row that has never closed.
    expect(items.find((i) => i.id === `esc-closed-${e.id}`)).toBeUndefined();
  });

  it('adds a second, CLOSED event once the escalation closes — the row appears twice', async () => {
    const e = await prisma.escalation.create({
      data: {
        title: 'Certification slip was communicated late',
        partnerId,
        projectId,
        severity: 's1',
        status: 'resolved',
        closedAt: new Date('2026-07-20T00:00:00.000Z'),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        sourceKind: 'manual',
      },
    });

    const items = await getActivity({ kind: 'ecosystem' });
    const raised = items.find((i) => i.id === `esc-raised-${e.id}`);
    const closed = items.find((i) => i.id === `esc-closed-${e.id}`);
    expect(raised).toBeDefined();
    expect(closed).toBeDefined();

    expect(raised!.timestamp).toBe('2026-07-01T00:00:00.000Z');
    expect(closed!.timestamp).toBe('2026-07-20T00:00:00.000Z');
    // The closed event reads the CURRENT terminal state, in the same wording the detail
    // page uses ("Closed — Resolved"), never just "Resolved" alone.
    expect(closed!.subtitle).toContain('Closed — Resolved');
    expect(closed!.subtitle).toContain('S1');
    // Both events are the SAME escalation, so both link to it and share its statement.
    expect(raised!.href).toBe(closed!.href);
    expect(raised!.title).toBe(closed!.title);
  });

  it('scopes to a partner, and to a program, correctly', async () => {
    const otherPartner = await prisma.partner.create({
      data: {
        name: 'Stellantis',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
      },
    });
    const e = await prisma.escalation.create({
      data: { title: 'Brand-matrix sponsor missing', partnerId: otherPartner.id, sourceKind: 'manual' },
    });

    const onThisPartner = await getActivity({ kind: 'partner', id: otherPartner.id });
    expect(onThisPartner.some((i) => i.id === `esc-raised-${e.id}`)).toBe(true);

    const onWrongPartner = await getActivity({ kind: 'partner', id: partnerId });
    expect(onWrongPartner.some((i) => i.id === `esc-raised-${e.id}`)).toBe(false);

    const onSomeProgram = await getActivity({ kind: 'project', id: projectId });
    expect(onSomeProgram.some((i) => i.id === `esc-raised-${e.id}`)).toBe(false);
  });

  it('suppresses the scope\'s own name from the subtitle, on a partner\'s own feed', async () => {
    const e = await prisma.escalation.create({
      data: { title: 'Audio HAL bring-up slip', partnerId, sourceKind: 'manual' },
    });
    const items = await getActivity({ kind: 'partner', id: partnerId });
    const raised = items.find((i) => i.id === `esc-raised-${e.id}`);
    expect(raised!.subtitle).not.toContain('Volvo Cars');
  });

  describe('person scope', () => {
    it('shows RAISED for a chat-sourced escalation attributed to them by raisedBy', async () => {
      const e = await prisma.escalation.create({
        data: {
          title: 'EX90 cert slip escalated from chat',
          partnerId,
          sourceKind: 'chat',
          raisedBy: 'lena@continental.example',
        },
      });
      const items = await getActivity({ kind: 'person', id: raiserPersonId });
      expect(items.some((i) => i.id === `esc-raised-${e.id}`)).toBe(true);
    });

    it('never shows a CLOSED event, even for an escalation this person raised and closed', async () => {
      const e = await prisma.escalation.create({
        data: {
          title: 'Already resolved by the time anyone asked',
          partnerId,
          sourceKind: 'chat',
          raisedBy: 'lena@continental.example',
          status: 'resolved',
          closedAt: new Date(),
        },
      });
      const items = await getActivity({ kind: 'person', id: raiserPersonId });
      expect(items.some((i) => i.id === `esc-raised-${e.id}`)).toBe(true);
      // The post-back deliberately never records who closed it — there is no actor to
      // match a person against, so the feed cannot claim one either.
      expect(items.some((i) => i.id === `esc-closed-${e.id}`)).toBe(false);
    });

    it('never shows a manually-created escalation — it has no actor column at all', async () => {
      const e = await prisma.escalation.create({
        data: { title: 'Raised in the app, not chat', partnerId, sourceKind: 'manual' },
      });
      const items = await getActivity({ kind: 'person', id: raiserPersonId });
      expect(items.some((i) => i.id === `esc-raised-${e.id}`)).toBe(false);
    });
  });
});
