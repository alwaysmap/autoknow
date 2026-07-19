# Database & infrastructure changes — STOP and read the playbook

Before any change touching `prisma/schema.prisma`, `infra/terraform/**`, secrets, or env
vars, read **[docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md)** and follow it exactly.
Non-negotiables (full rules + PR recipes in the playbook):
- **Never `prisma db push`, `migrate reset`, or drop/edit an already-applied migration against a
  shared/prod DB.** Production is forward-only `prisma migrate deploy`; `db push` can delete data.
- **Additive schema changes** (new table, nullable/defaulted column, index) may ship with app
  code in **one PR**. **Destructive ones** (drop/rename/retype a column) MUST be split
  **expand → backfill → contract** across separate merges — one step per deploy.
- **Adding** infra the app needs: infra PR + `terraform apply` (human) FIRST, then the app PR.
  **Removing** infra: app PR first, then the infra PR. Gate new features on env presence so they
  stay dark until their infra exists.
- `terraform apply` is human-run; app deploys are automatic on merge to `main`.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Visual & UX Design Guidelines

All visual designs, layouts, and UX interaction patterns must adhere strictly to the rules documented in [design.md](file:///Users/dylan/projects/goog/autoknow/design.md). Key patterns:
* **Everything is a URL**: Avoid plain-text entity displays. Hyperlink all partners, suppliers, phase markers, and LDAP names.
* **Tufte Visual Cleanliness**: Maintain high data-ink ratios; no redundant borders or blocky layouts.
* **Percentage-Free Gauges**: Never display numeric progress percentages or risk strings inside interactive dial gauges or hill charts.
* **2-Column Sidebar Layout**: Use side-by-side grids for detail panels to maximize screen utility and prevent layout empty spaces.
