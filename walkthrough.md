# Walkthrough: Ecosystem Summary, Onboarding Controls, and status History Logs

> **Historical snapshot** — this walkthrough describes the app as of an early
> milestone and is not updated as features change. Routes, coverage numbers, and
> feature details may have drifted (e.g. `/projects/*` routes later moved to
> `/programs/*`). For current truth: [README.md](README.md) and
> [docs/OPERATIONS.md](docs/OPERATIONS.md).

We have implemented the full operational flow of AutoKnow, providing partner tracking, project dashboards, biographical timelines, gut-feel status sliders, constraints diagnostics, and developer seeding tools.

## Operational URL Routes
*   **Home Dashboard**: [http://localhost:3000](http://localhost:3000)
*   **Ecosystem**: [http://localhost:3000/ecosystem-summary](http://localhost:3000/ecosystem-summary)
*   **Me Landing Page**: [http://localhost:3000/me?user=@dylan](http://localhost:3000/me?user=@dylan)
*   **Partners Page**: [http://localhost:3000/partners](http://localhost:3000/partners)
*   **Create Project**: [http://localhost:3000/programs/new](http://localhost:3000/programs/new)
*   **Dev Console**: [http://localhost:3000/admin](http://localhost:3000/admin)
*   **Search Page**: [http://localhost:3000/search?q=Ford](http://localhost:3000/search?q=Ford)

---

## Implemented Features

### 1. Onboarding Console & Empty Onboarding States (`/admin` & `/`)
To guarantee an excellent first-run experience:
- **Developer Console (`/admin`)**: Provides controls to seed defaults only (clean onboarding experience with partners but empty metrics/projects), seed mock demo data (fully populated state), or wipe all data.
- **Onboarding Guides**: The Home dashboard dynamically renders helpful guides with quick-start call-to-actions (e.g. template selectors) if the system is blank.
- **Webhook Helpers**: Provides copy-pasteable `curl` webhook payloads on `/admin` to test or simulate status updates from Google Chat webhooks.

### 2. Flow Constraint Diagnosis (`/ecosystem-summary`)
- Identifies the main flow constraints across integration projects by calculating typical stage durations.
- Displays a dedicated **Flow Constraint Diagnosis** panel, highlighting `Compliance Testing` as the slowest stage (54 days p85).

### 3. Visual Gauges & Explicit Update Overlays (`/projects/[id]`)
We have completely redesigned the status update controls on the project detail dashboard:
- **Interactive Visual Gauge for The Needle**: Replaced the range input slider with a gorgeous SVG semi-circle gauge. Features 4 colored sectors (Low, Medium, High, Critical) and a real rotating pointer needle pointing to the current value.
- **Visual Hill Chart Bell Curve**: Renders a custom cubic-bezier SVG bell-curve representing project progress. Displays a glowing indicator node exactly positioned on the curve using parameterized mathematical coordinates.
- **Explicit Status Dialog Modals**: Clicking "Update Needle" or "Update Progress" opens a clean, native overlay dialog (`<dialog>` with `closedby="any"` and manual backdrop boundaries dismiss fallbacks). Users can explicitly set the value, write a qualitative update note, and save.
- **Project Settings Metadata**: Moved static fields (Owner, SOP Target, 12M Vol) into a dedicated Project Metadata card to avoid cluttering status updates.

### 4. Layout Cleanups & Shortened Titles
- Removed redundant brand prefix repetition ("AutoKnow") from page body headers.
- Reduced the page title sizes (h1 heading sizes reduced to `1.5rem` for cleaner aesthetics).
- Shortened page titles to clean names: e.g. "My Projects Accountabilities" -> "My Projects", "Ecosystem Summary" -> "Ecosystem", "Developer & Admin Console" -> "Dev Console".

### 5. Interactive DataTable Component
- Built a generic, reusable client-side `<DataTable>` component.
- Implemented **interactive column sorting** (handling numeric, alphabetical, and date parsing, including nested fields like `partner.name`) and **pagination** (defaulting to 10 results per page with footers showing counts).
- Applied this component to the Action Items, Programs at Risk, and Ecosystem Launches tables.

### 6. Parametrized pgvector Search Page (`/search`)
- Created a search page at `/search?q=query` performing a hybrid search:
  - Cosine distance semantic similarity queries on pgvector `ContextUrl` tables using `$queryRaw`.
  - Database literal matches on partner names, projects, and people.
- Integrated a **"See all results"** link at the bottom of the global header search dropdown leading to this page.

### 7. Deletion Safeguard Confirmation
- Clicking "Delete Project" in the project details header now prompts the user with a warning dialog instead of immediately deleting.
- The dialog requires the user to type the exact name of the project to enable the "Permanently Delete Project" button, preventing accidental losses.

### 8. Service Worker & Offline Browsing Support
- **Service Worker (`public/sw.js`)**: Runs in the background caching document layouts, static styles, assets, and visited page paths (Network-First-with-Cache-Fallback for documents, Cache-First for static resources).
- **Network-First RSC updates**: Ensures Next.js Server Action revalidations are fetched fresh from the server instead of being served from stale caches.
- **Offline Indicator Badge**: Added a client-side network monitor (`<OfflineIndicator>`) in the header next to the search bar. Shows a pulsing green "Online" badge when connected and a blinking amber "Working Offline (Cached)" pill when network connection is lost.
- **Search Offline Fallback**: Search features display a clean alert explaining that semantic queries require pgvector database connections.

### 9. Industry SOP Target & Volumes Chart (`/ecosystem-summary`)
- Added a gorgeous, interactive SVG timeline graph (`EcosystemSopChart`) at the top of the Ecosystem page.
- Maps sorted project SOP dates on the X-axis against shipping volumes on the Y-axis.
- Highlights individual programs (vertical stems colored by Needle status) and traces a cumulative industry shipping total line (orange curve). Hovering over chart elements exposes real-time target metrics in a tooltip.

### 10. Partner List Index Page (`/partners`)
- Displays all ecosystem partners (both OEM and Suppliers) using the client-side `<DataTable>` component supporting sorting and pagination.
- Displays active and lifetime counts of programs they are involved in.
- Provides filter select controls for partner types and a **My Partners Only** filter showing only partners where the current user is either a project TEL or listed in the team of current employees/affiliations.

### 11. Me Landing Dashboard (`/me`)
- Created a highly personalized centralized user workspace replacing "My Projects".
- Displays the signed-in user's biography profile details, career affiliations timeline, active action items checklist, project accountabilities, and supplier/OEM partner relationships they manage.
- Sets up legacy `/my-projects` path redirects to transparently forward requests to `/me`.

### 12. Draggable Curve Handles Filter (`/ecosystem-summary`)
- Replaced the simple checkbox "Stuck" filter with a fully interactive progress range filter:
  - Users can drag two handles (From and To boundary nodes) directly along the visual SVG Hill Chart curve to filter projects by progress.
  - Dynamically highlights the active progress interval directly on the curve segment.

---

## Test Verification

All requirements are verified via strict E2E testing:
- **Playwright E2E Tests**: 90 scenarios running across Chromium, Firefox, and Webkit covering all routing, visual dials, deletion name confirmation, service worker caching, network indicators, partners index list, and "Me" landing page redirects. (**Passed**)
- **Jest Unit Tests**: 100% statement and line coverage. (**Passed**)
- **TypeScript & ESLint**: Clean compilation check.

### Key Commands
- `npm run test` - Runs Unit/DB tests (Jest)
- `npm run test:e2e` - Runs E2E tests (Playwright)
- `npm run dev` - Starts Next.js development server
