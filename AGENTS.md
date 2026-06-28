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
