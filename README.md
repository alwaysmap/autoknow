# AutoKnow

A relationship and project tracking system for Android Automotive Partner Engineering.

> Operational setup (Gemini key, GCP project, OAuth sign-in, service account,
> Chat app, refresh worker): see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Development Workflow

All key actions are accessible via `npm run` scripts.

### 1. Prerequisites
- Node.js (v18+)
- Docker and Docker Compose (for the PostgreSQL database with pgvector)

### 2. Starting the Application
First, start the local database container:
```bash
npm run db:up
```

Then, push the Prisma schema to initialize your database:
```bash
npm run db:push
```

Finally, start the Next.js development server:
```bash
npm run dev
```

### 3. Testing
This project strictly enforces TDD (Test-Driven Development). Any new code changes must have tests written first. We use black-box behavioral testing to ensure we test expectations, not implementation details.

**Unit and Component Tests (Jest):**
```bash
npm run test
npm run test:watch
npx jest --coverage  # Generate coverage reports (strictly >80%)
```

**End-to-End Tests (Playwright):**
Our Playwright configuration automatically starts a dev server in the background for you.
```bash
npm run test:e2e
npm run test:e2e:ui  # Opens the Playwright interactive UI
```

### 4. Ecosystem Summary Dashboard
The `/ecosystem-summary` page provides a unified deterministic + AI-driven synthesis of the entire partner engineering project portfolio:
- **p85 Lead Time**: Tracks the 85th percentile duration of active BSP/VHAL integration phases.
- **Monte Carlo Forecast**: Runs 1,000 statistical simulations on remaining uncompleted phases to output likely (+p85) and risk-bound (+p95) completion timeframes.
- **AI Status Synthesis**: Unified briefing summarizing active program blockers (e.g. supplier board delays) ingested from program notes.

**Ingesting Status Updates via Chat Webhook:**
You can post a project briefing from Google Chat to the integration endpoint `/api/integrations/chat`:
```bash
curl -X POST http://localhost:3000/api/integrations/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "@autoknow status update for \"Waymo Generation 6 AAOS\": BSP is green. Audio HAL integration is blocked due to codec samples from supplier."}'
```
This automatically parses the target program and records the status under `ContextUrl` for RAG-driven synthesis.

### 5. Database Management
```bash
npm run db:up      # Starts the postgres container in the background
npm run db:down    # Stops and removes the database container
npm run db:push    # Pushes schema changes to the database
npm run db:studio  # Opens Prisma Studio on port 5555 to view/edit database contents
```

### 6. Production Build
```bash
npm run build
npm run start
```
