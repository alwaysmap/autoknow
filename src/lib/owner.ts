import { prisma } from './db';
import { resolvePerson } from './people';

// A program's Googler owner must be an EXISTING Person — the form pickers only
// offer existing people, and this is the server-side seam that keeps hand-crafted
// submissions from landing freeform text in Project.ownerName. Accepts the same
// shapes resolvePerson does ('jdoe@google.com', '@jdoe', 'jdoe', a full name) and
// returns the person's canonical email, which is what the people pages match on.
export async function requireOwnerEmail(input: string): Promise<string> {
  const people = await prisma.person.findMany({ select: { id: true, name: true, email: true } });
  const person = resolvePerson(people, input);
  if (!person) throw new Error(`Owner must be an existing person — no match for “${input}”`);
  return person.email;
}
