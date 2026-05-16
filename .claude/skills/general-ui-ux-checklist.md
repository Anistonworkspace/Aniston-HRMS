# General UI/UX Checklist

Reusable, project-agnostic UI/UX checklist. Pair it with the **General UI/UX Auditor & Design System Guardian** agent (`.claude/agents/general-ui-ux-auditor.md`) or use it standalone.

Mark each item as **Pass**, **Fail**, or **Needs verification**. Do not skip sections — visual regressions usually hide in the sections you trust.

## Purpose and Usage

- Use this skill **before** a UI change (to plan) and **after** a UI change (to verify nothing regressed)
- Use it on any framework / styling stack (React, Vue, Angular, Svelte, Next, vanilla, etc.)
- Always inspect the actual code before answering — every check assumes you have already read the relevant component
- Prefer the project's existing tokens, primitives, and patterns over introducing new ones
- When in doubt, mark **Needs verification** rather than guessing **Pass**

## Project Discovery

- [ ] Framework identified (React / Vue / Angular / Svelte / Next / Remix / etc.) and version pinned
- [ ] UI library identified (Tailwind / Material / Chakra / Ant / Radix / ShadCN / vanilla / etc.)
- [ ] Animation library identified (Framer Motion / GSAP / CSS-only / Web Animations API)
- [ ] Icon library identified (lucide / heroicons / phosphor / fontawesome / material-icons / custom SVG)
- [ ] Theming approach identified (Tailwind tokens / CSS variables / theme object / styled-components theme)
- [ ] Token / theme source files located
- [ ] Layout / shell root component located
- [ ] Header / sidebar / navigation components located
- [ ] Modal / dropdown / toast primitives located
- [ ] Form / input / button primitives located
- [ ] Table / list / card components located
- [ ] Empty / loading / error state components located
- [ ] Route guards / permission helpers identified (if present)
- [ ] i18n / localization mechanism identified (if present)
- [ ] Test stack identified (Vitest / Jest / Playwright / Cypress / Storybook)
- [ ] Screenshots (if provided by user) compared against the actual code

## Visual Identity

- [ ] Industry tone matches existing (enterprise / consumer / playful / utilitarian / editorial)
- [ ] Density matches existing (compact / regular / spacious) — do not bloat compact UIs
- [ ] Personality preserved (rounded vs sharp, soft vs flat shadows, monochrome vs colorful)
- [ ] No new design language fragment introduced (don't pull in a different vibe mid-app)
- [ ] Existing icon set used — no new icon library
- [ ] Existing typography hierarchy preserved
- [ ] No random redesign of unrelated surfaces

## Tokens & Color

- [ ] No hex literals introduced where a token exists — use the project's color tokens
- [ ] Theme variables used for theme-adaptive surfaces (CSS variables, theme object, etc.)
- [ ] Semantic colors used where applicable (success / warning / danger / info)
- [ ] Domain-specific palettes (status / priority / category) come from the existing constants — don't redefine them
- [ ] Neutral ramp (background / surface / border / text-primary / text-secondary / text-muted) reused
- [ ] Dark-mode / multi-theme parity preserved — every new color resolves in every supported theme
- [ ] No parallel color palette introduced (e.g. don't mix Tailwind `gray-*` and `zinc-*` if the project picked one)
- [ ] Forbidden ad-hoc hex literals NOT reintroduced (check for legacy debt the project is migrating away from)
- [ ] No hardcoded white / black surfaces unless the existing palette already uses them
- [ ] Color contrast meets WCAG AA in both/all themes

## Typography

- [ ] Existing font family used — no new web font loaded
- [ ] Display font (if defined) used only where it's already used; not freely
- [ ] Existing type scale honored — don't introduce new sizes
- [ ] Existing weights honored — don't promote a weight that doesn't already appear in the design
- [ ] Line height matches existing rules
- [ ] Letter-spacing preserved on headlines / uppercase labels
- [ ] Tabular numerals used for counters, metrics, data tables, badge counts
- [ ] No hardcoded `px` font sizes that bypass the project's font-scale system (root font-size, user font-size preference, accessibility scaling)
- [ ] Truncation rules consistent (`text-ellipsis` / `truncate` / `line-clamp`) with existing surfaces

## Layout & Shell

- [ ] Root layout component preserved — no new outer wrapper inserted
- [ ] Header / topbar height + padding match existing
- [ ] Sidebar collapsed / expanded / resize behavior preserved
- [ ] Mobile shell (drawer / sheet / bottom-nav) behavior preserved
- [ ] Page content uses the existing scroll/overflow container — no new `overflow-auto` outer wrapper unless intentional
- [ ] Container / card spacing matches existing
- [ ] Grid / flex patterns consistent with neighboring code
- [ ] Z-index fits the documented stack; no arbitrary `z-9999` that conflicts with modal / toast layers
- [ ] Responsive breakpoints follow the project's convention — no bespoke media queries
- [ ] No dropdowns / popovers clipped by `overflow:hidden` ancestors (portal them if needed)

## Navigation / Header / Sidebar

- [ ] Sidebar items use the existing item primitive / class
- [ ] Active item styling matches existing
- [ ] Section labels (if present) match existing typography (size, casing, color)
- [ ] Sidebar resize / collapse behavior preserved
- [ ] Mobile sidebar overlay behavior preserved (slide + backdrop)
- [ ] Header height and right-side icon row preserved
- [ ] Header icon styling consistent (size, stroke, hover bg, active route highlight)
- [ ] Badge styling consistent (sidebar pill vs header notification dot — both kept distinct if that's the project pattern)
- [ ] Count formatting consistent (cap at `99+` / `999+` depending on project convention)
- [ ] Role / permission gating preserved on nav items
- [ ] Header items not duplicated in sidebar (and vice versa) unless intentional
- [ ] Mobile nav strategy preserved (drawer / hamburger / bottom-nav)

## Component Primitives

- [ ] Buttons use existing variants — no inline ad-hoc button styles
- [ ] Compact / dense surface variants used inside dense modals/popovers (if the project has them)
- [ ] Existing badge / chip / pill family used — no parallel badge style
- [ ] Existing avatar component used — no inline initials/gradient implementation
- [ ] Existing tabs primitive used — including correct active indicator
- [ ] Existing tooltip primitive used — no second tooltip library
- [ ] Existing skeleton / loader used — no new spinner library
- [ ] Existing empty state pattern used
- [ ] Existing error boundary covers the new sub-tree

## Forms & Input

- [ ] Inputs use existing input class / component
- [ ] Compact form variant used inside modals if the project has one
- [ ] Focus ring preserved (color + width + offset)
- [ ] Disabled state preserved (`opacity` / `cursor-not-allowed` / `pointer-events-none`)
- [ ] Loading state preserved (spinner inside button, disabled fields, etc.)
- [ ] Label / input / helper-text typography consistent
- [ ] Required indicator consistent (`*` / "(required)" / pseudo-element — whatever the project uses)
- [ ] Inline validation errors appear near the field — not blocking the whole surface
- [ ] Server validation errors shown clearly with field-level mapping
- [ ] Placeholder color and behavior consistent
- [ ] Autofocus only on intentional first field

## Tables / Lists / Cards

- [ ] Header style and cell density match existing tables
- [ ] Default columns preserved — don't change the default set without explicit ask
- [ ] Sticky-left columns (if any) behave correctly across horizontal scroll
- [ ] Row states (default / hover / selected / overdue / disabled / muted) preserved
- [ ] Status / priority / category cells use the existing palette
- [ ] Bulk action UI appears only when rows are selected (if that's the existing pattern)
- [ ] Drag/drop affordance consistent (grip handle style + position)
- [ ] Sort / filter / column-options UI matches existing
- [ ] Custom columns / extensibility preserved if the project supports it
- [ ] Realtime / live updates reflected without forcing a full refetch
- [ ] Large lists use pagination, virtualization, or windowing where the project does

## Modal / Dialog / Drawer

- [ ] Existing modal / drawer primitive used — no third primitive introduced
- [ ] Backdrop style, blur, and color match existing
- [ ] Focus trap preserved (Tab cycles within, Shift+Tab reverses)
- [ ] Esc closes — and only closes the topmost surface
- [ ] Body scroll lock preserved while open
- [ ] Focus restored to the trigger element on close
- [ ] Existing modal sizes used — no bespoke `max-w-[XYZ]` value
- [ ] Compact modal classes used inside dense surfaces
- [ ] Portal rendering used where the host project portals (avoids overflow clipping)
- [ ] Z-index fits the documented stack
- [ ] Reduced motion respected
- [ ] Mobile behavior verified (full-screen sheet / bottom-sheet / centered)
- [ ] No custom backdrop / focus-trap rolled — extend the primitive instead

## Dropdown / Popover / Tooltip

- [ ] Existing dropdown / popover primitive used
- [ ] Portal-rendered if trigger lives inside an `overflow:hidden` container
- [ ] Auto-flip upward when no room below
- [ ] Horizontal viewport-clamp (don't overflow off-screen)
- [ ] Z-index above the surface that triggered it
- [ ] Escape and click-outside close
- [ ] Animation matches existing (timing + easing)
- [ ] Tooltip uses the project's tooltip primitive or native `title` — no second tooltip library

## Toast / Notification

- [ ] Existing toast system used — never roll a custom toast
- [ ] Position consistent (top-right / top-center / bottom-right / etc.)
- [ ] Type used correctly (`success` / `error` / `warning` / `info` / project-specific)
- [ ] Default duration matches project convention
- [ ] Dedup window respected (so duplicate events don't double-fire)
- [ ] Stack limit respected (oldest dropped when full)
- [ ] Hover-to-pause behavior preserved if the project has it
- [ ] `role` + `aria-live` correct per type (`alert` / `assertive` for errors, `status` / `polite` otherwise)
- [ ] Click-through routing (if supported) navigates to the linked entity
- [ ] Push / OS notifications only fire under documented conditions (permission granted, tab hidden, etc.)
- [ ] Unread count / badge updates in realtime — no full refetch
- [ ] Toast tray uses `pointer-events: none` (individual toasts re-enable) so layout doesn't block page clicks

## Empty / Loading / Error States

- [ ] Empty state uses the project's empty-state component / pattern — no bare empty div
- [ ] Loading uses skeleton OR spinner depending on the project's convention (do not mix without reason)
- [ ] No blank flashes between loading and loaded
- [ ] Error boundary wraps risky sub-trees
- [ ] User-visible error text routed through toast / banner / dialog — never raw `alert()`
- [ ] Retry affordance present when the failure is recoverable
- [ ] Permission denied / 403 has its own state (not silent or generic)

## Responsive / Mobile / PWA

- [ ] Existing breakpoint convention used
- [ ] Mobile sidebar / drawer behavior preserved
- [ ] Component-level responsive collapses (grid → column, multi-pane → tabs) consistent with existing
- [ ] Touch targets are ≥44×44 (or whatever the project's accessibility floor is)
- [ ] No hover-only interactions on mobile-critical paths
- [ ] PWA install / update prompts (if present) not broken
- [ ] Service worker (if present) still receives push / cache updates
- [ ] Manifest icons / splash screens not affected
- [ ] Safe-area insets respected on mobile (notch / home indicator)

## Accessibility

- [ ] Keyboard navigation works (Tab cycles, Shift+Tab reverses, arrow keys for grids/listboxes)
- [ ] `:focus-visible` outline preserved (or matches the project's focus style)
- [ ] Focus trap and restoration work in modals / dropdowns
- [ ] Icon-only buttons have `aria-label` (and `title` if hover hint is desired)
- [ ] Count badges expose `aria-live="polite"` / `aria-atomic="true"`
- [ ] `role` + `aria-live` set correctly on toasts / dynamic regions
- [ ] Color contrast meets WCAG AA in all themes
- [ ] Form inputs have associated `<label>` (or `aria-label` / `aria-labelledby`)
- [ ] Esc closes the topmost focusable surface
- [ ] Skip-to-main-content link present and works
- [ ] `prefers-reduced-motion` short-circuits all new animations
- [ ] Tables and grids have correct roles (`role="grid"`, header cells, scope) where applicable
- [ ] Live regions don't re-announce on every render

## i18n / Localization

- [ ] If the project ships multiple locales, every new string is added to ALL of them — not just the default
- [ ] User-created data (titles, names, free-text fields) is NOT translated — only system/default labels are
- [ ] Default / system strings translated only when the field is still the untranslated default
- [ ] Plural / gender / numeric formatting rules use the project's i18n primitive
- [ ] Date / time formatting uses the project's date library
- [ ] RTL languages (if supported) still lay out correctly (mirrored padding, no hardcoded left/right margins)
- [ ] No hardcoded English strings outside the locale files

## Animation / Motion

- [ ] Canonical easing curve used (e.g. `cubic-bezier(0.16, 1, 0.3, 1)` or whatever the project defines)
- [ ] Standard durations used (fast / normal / slow)
- [ ] Page transitions consistent with existing
- [ ] Modal / dropdown / toast animations consistent with existing
- [ ] Stagger animations follow existing pattern
- [ ] `prefers-reduced-motion` respected — animations short-circuit to ~0ms
- [ ] No transform-on-hover that fights layout (especially in grids and bento tiles)
- [ ] Heavy animations (Framer Motion, GSAP) NOT applied to long lists without virtualization
- [ ] No new animation library introduced

## Performance

- [ ] No unnecessary re-renders (memoize wide-table rows, expensive components)
- [ ] List virtualization / pagination used where the data set is large
- [ ] No N+1 fetch patterns (request waterfalls) introduced
- [ ] Realtime updates patch local state instead of triggering a full refetch
- [ ] Skeleton / loader during fetch — no blank flashes
- [ ] Images use `loading="lazy"`, `srcset`, or the project's image primitive
- [ ] Bundle impact justified for any new dependency
- [ ] No new UI library added without explicit need
- [ ] Animation cost on long lists measured (60fps target on mid-range hardware)
- [ ] Avatars / icons / sprite sheets sized appropriately

## State / Data Sync

- [ ] State management primitive used consistently (Context / Redux / Zustand / Pinia / signals / etc.)
- [ ] Optimistic updates revert on server error
- [ ] No stale state after a socket / SSE reconnect
- [ ] Multi-tab updates reflect via the project's sync mechanism (sockets, BroadcastChannel, etc.)
- [ ] Session / auth changes (login, logout, force-logout) handled cleanly across the app
- [ ] Loading / error / success state are mutually exclusive (no double-spinning, no stale errors)
- [ ] Cache invalidation is targeted, not global
- [ ] Realtime event handlers don't pile up (unsubscribe on unmount)

## Security & Privacy UX

- [ ] Sensitive fields not auto-revealed (passwords, tokens, secrets) — explicit "show" affordance
- [ ] Copy-to-clipboard for secrets clears clipboard on a timer if the project does that
- [ ] Destructive actions (delete, revoke, archive, force-logout) require confirmation
- [ ] Session lock / single-active-session UX preserved (banner, lock screen)
- [ ] PII (email, phone, ID) not exposed in shared logs / error messages
- [ ] File uploads honor the project's MIME / size / extension allowlist UX
- [ ] Permission denials shown clearly (not silent failures)
- [ ] CSRF / clickjacking protections (if the project applies them) not bypassed by new iframes

## Regression-Risk Hotspots

Flag explicitly if the change touches any of these:

- [ ] Sticky-positioned columns / headers
- [ ] Grid / bento / masonry layouts
- [ ] Sidebar / nav resize, collapse, or ordering
- [ ] Header / nav badges (count display, ring/border)
- [ ] Modal focus trap
- [ ] Dark-mode / theme tokens or token overrides
- [ ] Mobile / PWA breakpoint behavior
- [ ] Realtime sync between pages and modals
- [ ] Custom-column / extensible table cells
- [ ] Role / permission gating UI
- [ ] i18n locale parity
- [ ] Browser push / OS notifications
- [ ] Animation timing on transitions users have already learned to expect

## Required Output Format

When this skill is invoked, respond in this order:

1. **Visual reference noted** — if screenshots were provided, name the surface and reconcile against code.
2. **Current UI understanding** — one or two sentences summarising the surface and intent.
3. **Files inspected** — bulleted list with `[file.ext:line](path/to/file.ext#L42)` clickable references.
4. **Existing pattern to reuse** — name the token / class / primitive / component.
5. **Checklist result** — relevant sections from this file marked `Pass` / `Fail` / `Needs verification`, with a one-line reason for each non-Pass.
6. **Recommended change** — short description, including which design rules it honors.
7. **Exact implementation plan** — file-by-file, line-anchored, smallest possible edits.
8. **Acceptance criteria** — what "done" looks like, both visually and behaviorally.
9. **Risk / edge cases** — theme parity, focus trap, mobile, reduced motion, role gating, regression hotspots.
10. **Test checklist** — manual + automated steps (using the project's existing test stack).
11. **Approval gate** — do NOT proceed with code changes until the user approves, UNLESS the user has explicitly asked to implement.