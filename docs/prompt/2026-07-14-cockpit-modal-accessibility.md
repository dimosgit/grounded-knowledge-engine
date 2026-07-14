# Feature Prompt Template

## 1. Feature Title

`Cockpit Modal and Drawer Accessibility`

## 2. Objective

Give every modal-like Cockpit surface consistent keyboard, focus, and screen
reader behavior. Preserve the current visual design while making Ask, Capture
Review, command search, and mobile navigation operable without a pointer.

## 3. Context

- Product area: `AskDrawer, CaptureReviewDrawer, CommandBar, mobile navigation, and shared UI primitives`
- Current behavior: `Ask and Capture Review declare modal dialogs but do not consistently handle Escape, initial focus, focus trapping, focus restoration, background inertness, or body scroll; CommandBar lacks complete dialog/listbox semantics.`
- Problem to solve: `Keyboard and assistive-technology users can leave a modal surface, lose their prior focus, or receive incomplete state information.`

## 4. Scope

- In scope:
  1. Shared accessible modal behavior.
  2. Ask and Capture Review drawers.
  3. Command search and mobile navigation when presented modally.
  4. Keyboard and focus tests.
- Out of scope:
  1. Visual redesign or navigation information architecture changes.
  2. Replacing the animation library.
  3. A repository-wide accessibility certification.
  4. Content scaling or engine changes.

## 5. Requirements

1. Create one reusable modal-surface hook or component rather than four copies
   of keyboard/focus logic.
2. Move focus to the first meaningful control or an explicit initial-focus target on open.
3. Trap Tab and Shift+Tab within the active modal surface.
4. Close on Escape unless a destructive request is actively submitting.
5. Restore focus to the element that opened the surface after close.
6. Prevent background scrolling and make background application content inert or
   equivalently unavailable to assistive technology while open.
7. Supply `aria-labelledby` and, where useful, `aria-describedby` for every dialog.
8. Give CommandBar dialog, combobox, listbox, option, active-option, and no-result
   states coherent semantics.
9. Avoid modulo-by-zero or invalid selection state when command results are empty.
10. Ensure loading, success, and error changes use appropriate live-region behavior.
11. Respect reduced-motion preferences for modal transitions.

## 6. Technical Constraints

1. Prefer platform behavior and a small local utility; do not add a large UI framework.
2. Preserve current drawer layout and responsive breakpoints.
3. Do not make hidden production-only controls focusable.
4. Tests must use user-visible keyboard behavior rather than implementation details.

## 7. Implementation Notes

1. Suggested files: a new component/hook under `apps/cockpit/src/components/`
   or `hooks/`, the four modal surfaces, and focused Testing Library tests.
2. If using the native `dialog` element, first verify JSDOM behavior and provide
   a deterministic test setup. Do not mix native and custom modal semantics inconsistently.
3. Cover nested-open prevention: only one operator drawer should be active at a time.
4. Preserve click-outside close where it is currently intentional.

## 8. Test Requirements

1. Add or update automated tests for all changed behavior.
2. Run relevant checks before commit:
   - Lint: `npm --prefix apps/cockpit run lint`
   - Type check: `npm --prefix apps/cockpit run typecheck`
   - Unit/integration/e2e tests: `npm --prefix apps/cockpit run test && npm --prefix apps/cockpit run build && npm --prefix apps/cockpit run test:production-boundary`
   - Formatting: `npm --prefix apps/cockpit run format:check`
   - Sanitization: `npm run scrub`
3. Do not create a commit if any required check fails.

## 9. Acceptance Criteria

1. Keyboard focus cannot leave an open drawer or command dialog with Tab navigation.
2. Escape closes each idle modal surface and returns focus to its opener.
3. Background content is not scrollable or exposed as active modal content.
4. Command search announces result state and keyboard selection correctly, including zero results.
5. Existing pointer interactions and responsive layouts continue to work.

## 10. Deliverables

1. Code changes implementing the feature.
2. Test changes proving correctness.
3. Short implementation summary including test command results.

## 11. Mandatory Agent Rules

1. Execute all required tests before creating any commit.
2. Never commit code with failing tests.
3. Report exact commands executed and whether each passed.
4. Escalate blockers instead of skipping required validation.
5. If preparing a commit, stage only the intended files before the final
   npm run scrub because the tracked-file string scan does not inspect untracked
   additions. Do not stage unrelated user changes.

## 12. Assumptions and Open Questions

- Assumptions:
  1. One modal operator surface at a time is the intended interaction model.
- Open questions:
  1. None. Do not include general color-contrast or document-content remediation.
