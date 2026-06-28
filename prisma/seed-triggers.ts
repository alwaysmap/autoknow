import { prisma } from '../src/lib/db';

async function main() {
  console.log('Setting up pgvector triggers...');

  const sql = `
    -- 1. Create function to generate deterministic embeddings
    CREATE OR REPLACE FUNCTION generate_deterministic_embedding(text_val text) 
    RETURNS vector AS $$
    DECLARE
      hash_val bigint := 0;
      i integer;
      x double precision;
      embedding_vals double precision[] := '{}';
    BEGIN
      FOR i IN 1..length(text_val) LOOP
        hash_val := (ascii(substring(text_val from i for 1)) + ((hash_val * 32) - hash_val))::bigint;
        hash_val := (hash_val + 2147483648::bigint) % 4294967296::bigint - 2147483648::bigint;
      END LOOP;

      FOR i IN 0..767 LOOP
        x := sin(hash_val + i) * 10000.0;
        embedding_vals := array_append(embedding_vals, x - floor(x));
      END LOOP;

      RETURN embedding_vals::vector;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;

    -- 2. Create triggers to update embeddings on Project insert/update
    CREATE OR REPLACE FUNCTION update_project_embedding()
    RETURNS trigger AS $$
    BEGIN
      NEW.embedding := generate_deterministic_embedding(NEW.name || ' owner: ' || COALESCE(NEW."ownerName", ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_project_embedding ON "Project";
    CREATE TRIGGER trg_project_embedding
    BEFORE INSERT OR UPDATE OF name, "ownerName" ON "Project"
    FOR EACH ROW EXECUTE FUNCTION update_project_embedding();

    -- 3. Create triggers for Partner
    CREATE OR REPLACE FUNCTION update_partner_embedding()
    RETURNS trigger AS $$
    BEGIN
      NEW.embedding := generate_deterministic_embedding(NEW.name || ' type: ' || NEW.type || ' summary: ' || COALESCE(NEW.summary, '') || ' region: ' || COALESCE(NEW.region, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_partner_embedding ON "Partner";
    CREATE TRIGGER trg_partner_embedding
    BEFORE INSERT OR UPDATE OF name, type, summary, region ON "Partner"
    FOR EACH ROW EXECUTE FUNCTION update_partner_embedding();

    -- 4. Create triggers for Person
    CREATE OR REPLACE FUNCTION update_person_embedding()
    RETURNS trigger AS $$
    BEGIN
      NEW.embedding := generate_deterministic_embedding(NEW.name || ' email: ' || NEW.email || ' notes: ' || COALESCE(NEW.notes, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_person_embedding ON "Person";
    CREATE TRIGGER trg_person_embedding
    BEFORE INSERT OR UPDATE OF name, email, notes ON "Person"
    FOR EACH ROW EXECUTE FUNCTION update_person_embedding();

    -- 5. Backfill existing embeddings
    UPDATE "Project" SET embedding = generate_deterministic_embedding(name || ' owner: ' || COALESCE("ownerName", ''));
    UPDATE "Partner" SET embedding = generate_deterministic_embedding(name || ' type: ' || type || ' summary: ' || COALESCE(summary, '') || ' region: ' || COALESCE(region, ''));
    UPDATE "Person" SET embedding = generate_deterministic_embedding(name || ' email: ' || email || ' notes: ' || COALESCE(notes, ''));
  `;

  await prisma.$executeRawUnsafe(sql);
  console.log(' pgvector triggers successfully seeded!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
