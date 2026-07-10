/** @jest-environment node */
import { prisma, disconnectTestDb } from './helpers/db';

describe('Prisma Client Connection', () => {
  it('should instantiate the Prisma Client and be able to query the database', async () => {
    // Verify that the prisma object is exported and is defined
    console.log("DATABASE_URL in test:", process.env.DATABASE_URL);
    expect(prisma).toBeDefined();

    // Query partners (should be empty but shouldn't throw an error)
    try {
      const partners = await prisma.partner.findMany();
      expect(Array.isArray(partners)).toBe(true);
    } catch (e) {
      console.error("PRISMA ERROR DETAILS:", e);
      throw e;
    }
  });

  afterAll(async () => {
    await disconnectTestDb();
  });
});
