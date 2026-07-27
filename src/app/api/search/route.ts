import { NextResponse } from 'next/server';
import { getFeed, FEED_TYPES, type FeedType, type FeedScope } from '../../../lib/feed';
import { serverError } from '../../../lib/api';

export const dynamic = 'force-dynamic';

// Standalone feed endpoint. With `q` -> relevance search; without -> recent activity.
//   /api/search?q=codec&types=program,context&partnerId=52
function toInt(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';

    const typesParam = searchParams.get('types');
    const types = typesParam
      ? typesParam.split(',').filter((t): t is FeedType => (FEED_TYPES as string[]).includes(t))
      : undefined;

    const partnerId = toInt(searchParams.get('partnerId'));
    const projectId = toInt(searchParams.get('projectId'));
    // `personId` narrows by ACTOR, not by subject. Without `q` that is their activity
    // feed; WITH `q` only the `person` type has a defined answer (see lib/search).
    const personId = toInt(searchParams.get('personId'));
    const scope: FeedScope =
      partnerId != null ? { kind: 'partner', id: partnerId }
        : projectId != null ? { kind: 'project', id: projectId }
          : personId != null ? { kind: 'person', id: personId }
            : { kind: 'ecosystem' };

    const items = await getFeed({ q, types, scope });
    return NextResponse.json({ items });
  } catch (error) {
    return serverError(error, 'GET /api/search');
  }
}
