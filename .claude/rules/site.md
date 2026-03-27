---
paths:
  - "site/**"
---
# Site Rules (Astro)

- Use Astro components (.astro) for pages and layouts. Use .md for content.
- Content collections are defined in `site/src/content.config.ts`. Follow the existing schema pattern when adding new collections.
- Styles live in `site/src/styles/`. Use CSS custom properties for theming.
- No JavaScript frameworks (React, Vue) — Astro's zero-JS default is the point.
- All pages go in `site/src/pages/`. Use Astro's file-based routing.
- When adding a new page, also add a nav link in the layout.
- Run `npm run build` in site/ to check for build errors before committing.
