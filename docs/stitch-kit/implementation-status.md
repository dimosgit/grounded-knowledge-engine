# Area-first and dual-theme implementation status

The Cockpit implements an optional, low-distraction area-first flow and two
complete visual themes.

## Area flow

A local workspace configuration can define explicit areas, project and document
membership, and an ordered focus list. When that configuration selects a default
area, the Cockpit opens it and shows its current item with the next items below.
Otherwise, the existing full-workspace start remains unchanged. Secondary records
stay behind Explore, global search, and full-workspace navigation.

Membership is never inferred from titles, tags, tracks, workspace names, or
semantic similarity. Empty and missing configurations produce honest empty
states. Public examples use only the neutral Delivery, Product, and Learning
categories.

## Themes

- **Slick Minimalist** uses a dark, focused palette, compact controls, and
  restrained depth.
- **Warm Paper** uses a light paper palette, editorial headings, sage accents,
  and softer card depth.

The active theme applies before first paint, persists locally, covers the full
Knowledge Base reader, and redraws Markdown diagrams with compatible colors.
The selector supports wrapped arrow navigation, Home and End, Escape dismissal,
and focus restoration. Both palettes meet WCAG AA contrast for normal text, and
reduced-motion preferences disable nonessential transitions.

## Verification

The Cockpit typecheck, lint, format check, accessibility and contrast tests,
area-scope and route tests, complete test suite, and production build pass. Root
workspace typecheck, domain-profile, and workspace-policy tests also pass.
Browser checks cover both themes, the full Knowledge Base reader, keyboard theme
selection, and responsive area states.
