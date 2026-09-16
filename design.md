# Operator Cockpit design specification

## Product intent

The Operator Cockpit is an optional review surface for a local-first grounded
knowledge engine. It helps an operator choose one area, see the next useful
item, and reach supporting records without presenting the entire system at
once.

The primary design goal is low distraction. Detail remains findable through
explicit navigation, search, and disclosure controls.

## Neutral area model

Public examples use three neutral categories:

| Area     | Purpose                                     | Example content                         |
| -------- | ------------------------------------------- | --------------------------------------- |
| Delivery | Active commitments and operational outcomes | Milestones, checklists, delivery notes  |
| Product  | Product initiatives and experiments         | Plans, validation tasks, research notes |
| Learning | Structured study and knowledge development  | Topics, exercises, review notes         |

These categories are presentation scopes, not security boundaries. Membership
comes from explicit workspace configuration. The application never infers an
area from names, titles, tags, or semantic similarity.

Organization-specific labels and record membership belong only in local,
gitignored workspace configuration. Public fixtures, screenshots, prompts,
and documentation must use neutral fictional data.

## Primary flow

1. **Choose an area.** Show only the three area choices and short descriptions.
2. **Focus.** Show one current item and up to two ordered next items when the
   configuration provides them.
3. **Explore on demand.** Provide deliberate routes to related projects,
   documents, decisions, attention items, planning, and review.
4. **Return with context.** Closing secondary detail returns to the same area
   and selection.

Empty areas state that no records are linked. They never substitute guessed or
cross-area content.

## Information hierarchy

The default focus view contains:

- the selected area and a clear way to change it;
- one current record with its primary action;
- no more than two next records;
- search, Explore, and full-workspace access as secondary actions.

Counts, activity feeds, dashboards, charts, and long metadata blocks remain
behind intentional navigation. Urgent information appears inside the Attention
view instead of becoming a badge on every screen.

## Visual themes

Both themes use the same content, actions, and component tree.

### Slick Minimalist

- dark charcoal surfaces;
- crisp sans-serif typography;
- restrained indigo and teal accents;
- thin borders and compact controls;
- limited elevation.

### Warm Paper

- warm off-white paper surfaces;
- editorial serif headings with a readable sans-serif body;
- sage accents and fine rules;
- restrained corners and soft depth;
- complete coverage of the document reader and overlays.

The selector is available in desktop and mobile headers. The saved preference
applies before first paint and does not change navigation or data state.

## Interaction requirements

- Keyboard users can open the theme menu, move with arrow keys, jump with Home
  and End, close with Escape, and retain logical focus.
- Focus indicators remain visible in both themes.
- Normal text meets WCAG AA contrast.
- Reduced-motion preferences disable nonessential transitions.
- Layouts work at 390 px, 768 px, and desktop widths without horizontal page
  overflow.
- Details remain readable at 200% text enlargement.

## Data and architecture boundaries

- Markdown remains the canonical content source.
- Area membership and focus order come from explicit workspace configuration.
- Pure transformations stay in `apps/cockpit/src/domain/`.
- Browser effects stay in `apps/cockpit/src/hooks/`.
- Screen composition stays in `apps/cockpit/src/views/`.
- `App.tsx` remains a thin orchestrator.
- Theme selection is a device-local preference and never mutates knowledge
  records.

## Public fixture rules

Use fictional projects such as **Atlas rollout** and **Beacon research**. Use
generic role labels such as **Owner**, **Reviewer**, or **Contributor** without
real names. Use placeholder domains and paths. Never include organization
names, customer identifiers, private endpoints, local absolute paths,
credentials, or content copied from a local workspace.

## Acceptance criteria

- The entry view shows only neutral areas.
- Choosing an area shows only explicitly linked records.
- Missing or unmapped records do not leak into another area.
- Both themes cover every reachable surface without mixed light and dark panes.
- Search, Attention, Knowledge Base, project, and decision routes remain
  reachable.
- Mobile navigation and the theme selector fit within the viewport.
- Public builds contain sanitized demo content only.
