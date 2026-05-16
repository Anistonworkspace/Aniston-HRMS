# Design System — Build Specification

This document defines the **single source of truth** for UI across all software in this
codebase. Every module, page, component, and screen must be built against the tokens and
component specs below.

---

## Instructions for the AI Assistant

When generating or editing any frontend code in this project:

1. **Never hard-code a value that has a token.** Use the CSS variables in §10 — colors,
   spacing, radius, typography, shadows, motion. If you write `#0073ea`, `16px`, or
   `8px 16px` directly instead of `var(--primary-color)`, `var(--space-16)`, etc., that
   is a defect.
2. **Match component specs exactly.** Buttons, tabs, modals, dropdowns, inputs, menus,
   tooltips and toasts have defined sizes, paddings, states, and animations in §5–§8.
   Reproduce them — do not invent variants.
3. **Honor all interaction states** (§9): hover, active, selected, focus-visible,
   disabled, error, success. A component without its full state set is incomplete.
4. **Theming is mandatory.** Build light-first, but every color must come from a token so
   `.theme-dark` works automatically. Never use a raw hex inside a component.
5. **Stay on the 4px grid.** All spacing, sizing, and layout gaps are multiples of 4px
   via the spacing scale.
6. **When unsure, reuse — don't redesign.** If a pattern exists here, follow it. Keep the
   visual language consistent across every page.

Recommended placement: keep this file at the repo root (or in `.claude/`) so it is always
in context. You may also rename it to `CLAUDE.md` or register it as a project skill.

---

## 1. Color System

The system ships **two themes**: `light` (default) and `dark`. Components reference
*semantic* tokens (e.g. `--primary-color`); each theme remaps them. Add `.theme-dark` to a
parent element (e.g. `<body>`) to switch.

### 1.1 Brand & Primary

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary-color` | `#0073ea` | `#0073ea` | Primary actions, active states, links |
| `--primary-hover-color` | `#0060b9` | `#0060b9` | Hover on primary |
| `--primary-selected-color` | `#cce5ff` | `#133774` | Selected backgrounds |
| `--primary-selected-hover-color` | `#aed4fc` | `#0d2e65` | Hover on selected |
| `--primary-highlighted-color` | `#f0f7ff` | `#0d2753` | Subtle highlight wash |
| `--brand-color` | `#0073ea` | `#0073ea` | Brand surfaces |
| `--brand-hover-color` | `#0060b9` | `#0060b9` | Brand hover |
| `--link-color` | `#1f76c2` | `#69a7ef` | Inline links |

### 1.2 Text

| Token | Light | Dark |
|---|---|---|
| `--primary-text-color` | `#323338` | `#d5d8df` |
| `--secondary-text-color` | `#676879` | `#9699a6` |
| `--text-color-on-primary` | `#ffffff` | `#ffffff` |
| `--text-color-on-inverted` | `#ffffff` | `#323338` |
| `--disabled-text-color` | `rgba(50,51,56,0.38)` | `rgba(213,216,223,0.38)` |
| `--placeholder-color` | `#676879` | `#c3c6d4` |
| `--icon-color` | `#676879` | `#c3c6d4` |

### 1.3 Backgrounds & Surfaces

| Token | Light | Dark |
|---|---|---|
| `--primary-background-color` | `#ffffff` | `#181b34` |
| `--secondary-background-color` | `#ffffff` | `#30324e` |
| `--allgrey-background-color` | `#f6f7fb` | `#30324e` |
| `--grey-background-color` | `#f6f7fb` | `#181b34` |
| `--primary-background-hover-color` | `rgba(103,104,121,0.1)` | `rgba(103,104,121,0.3)` |
| `--disabled-background-color` | `#ecedf5` | `#3c3f59` |
| `--modal-background-color` | `#ffffff` | `#181b34` |
| `--dialog-background-color` | `#ffffff` | `#30324e` |
| `--backdrop-color` | `rgba(41,47,76,0.7)` | `rgba(41,47,76,0.7)` |
| `--inverted-color-background` | `#323338` | `#ffffff` |

### 1.4 Borders

| Token | Light | Dark |
|---|---|---|
| `--ui-border-color` | `#c3c6d4` | `#797e93` |
| `--layout-border-color` | `#d0d4e4` | `#4b4e69` |
| `--ui-background-color` | `#e7e9ef` | `#434660` |

### 1.5 Status / Feedback

| Meaning | Token | Light | Hover |
|---|---|---|---|
| Success | `--positive-color` | `#00854d` | `#007038` |
| Error | `--negative-color` | `#d83a52` | `#b63546` |
| Warning | `--warning-color` | `#ffcb00` | `#eaaa15` |

Selected variants: `--positive-color-selected` `#bbdbc9`,
`--negative-color-selected` `#f4c3cb`, `--warning-color-selected` `#fceba1`.

### 1.6 Content Color Palette ("color selection")

The swatch set for coloring tags, labels, statuses, groups, categories, etc. Each color
has a base, `-hover`, and `-selected` variant.

| Name | Hex | Name | Hex | Name | Hex |
|---|---|---|---|---|---|
| `grass_green` | `#037f4c` | `done-green` | `#00c875` | `bright-green` | `#9cd326` |
| `saladish` | `#cab641` | `egg_yolk` | `#ffcb00` | `working_orange` | `#fdab3d` |
| `dark-orange` | `#ff6d3b` | `peach` | `#ffadad` | `sunset` | `#ff7575` |
| `stuck-red` | `#df2f4a` | `dark-red` | `#bb3354` | `sofia_pink` | `#e50073` |
| `lipstick` | `#ff5ac4` | `bubble` | `#faa1f1` | `purple` | `#9d50dd` |
| `dark_purple` | `#784bd1` | `berry` | `#7e3b8a` | `dark_indigo` | `#401694` |
| `indigo` | `#5559df` | `navy` | `#225091` | `bright-blue` | `#579bfc` |
| `dark-blue` | `#007eb5` | `aquamarine` | `#4eccc6` | `chili-blue` | `#66ccff` |
| `river` | `#74afcc` | `winter` | `#9aadbd` | `explosive` | `#c4c4c4` |
| `american_gray` | `#757575` | `blackish` | `#333333` | `brown` | `#7f5347` |
| `orchid` | `#e484bd` | `tan` | `#bca58a` | `sky` | `#a1e3f6` |
| `coffee` | `#cd9282` | `royal` | `#216edf` | `teal` | `#175a63` |
| `lavender` | `#bda8f9` | `steel` | `#a9bee8` | `lilac` | `#9d99b9` |
| `pecan` | `#563e3e` | | | | |

Pattern for any swatch: `--color-{name}`, `--color-{name}-hover`, `--color-{name}-selected`.

---

## 2. Typography

### 2.1 Font Families

| Token | Stack | Used for |
|---|---|---|
| `--font-family` | `Figtree, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif` | Body, UI, controls |
| `--title-font-family` | `Poppins, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif` | H1–H4 headings |

Figtree and Poppins are free Google Fonts — load both. The Noto fallbacks cover
Hebrew/Arabic/Japanese. To rebrand the typeface, change only these two tokens; everything
else inherits.

### 2.2 Weights

| Token | Value |
|---|---|
| `--font-weight-very-light` | 200 |
| `--font-weight-light` | 300 |
| `--font-weight-normal` | 400 |
| `--font-weight-bold` | 500 |

Composite type tokens also use 600 (medium) and 700 (bold).

### 2.3 Type Scale

Each composite token is a CSS `font` shorthand: `weight size/line-height family`.

| Token | Weight | Size | Line height |
|---|---|---|---|
| `--font-h1` | 700 | 32px | 40px |
| `--font-h2` | 700 | 24px | 30px |
| `--font-h3` | 700 | 18px | 24px |
| `--font-text1-normal` | 400 | 16px | 22px |
| `--font-text1-medium` | 600 | 16px | 22px |
| `--font-text1-bold` | 700 | 16px | 22px |
| `--font-text2-normal` | 400 | 14px | 20px |
| `--font-text2-medium` | 600 | 14px | 20px |
| `--font-text2-bold` | 700 | 14px | 20px |
| `--font-text3-normal` | 400 | 12px | 16px |
| `--font-text3-medium` | 600 | 12px | 16px |
| `--font-text3-bold` | 700 | 12px | 16px |

Heading letter-spacing: H1 `-0.5px`, H2/H3 `-0.1px`.
**`text2` (14px) is the workhorse UI size** — buttons, inputs, tabs, menu items use it.

---

## 3. Spacing, Radius, Borders, Elevation, Motion

### 3.1 Spacing Scale (4px grid)

`--space-2 2px` · `--space-4 4px` · `--space-8 8px` · `--space-12 12px` · `--space-16 16px`
· `--space-20 20px` · `--space-24 24px` · `--space-32 32px` · `--space-40 40px`
· `--space-48 48px` · `--space-64 64px` · `--space-80 80px`

`8px` and `16px` are the most common gaps.

### 3.2 Border Radius

| Token | Value | Used for |
|---|---|---|
| `--border-radius-small` | `4px` | Buttons, inputs, menu items, chips |
| `--border-radius-medium` | `8px` | Popovers, cards, dialogs |
| `--border-radius-big` | `16px` | Modals |

`--border-width: 1px` · `--border-style: solid`

### 3.3 Elevation / Shadows

| Token | Light value | Used for |
|---|---|---|
| `--box-shadow-xs` | `0 4px 6px -4px rgba(0,0,0,0.1)` | Subtle lift |
| `--box-shadow-small` | `0 4px 8px rgba(0,0,0,0.2)` | Hover cards |
| `--box-shadow-medium` | `0 6px 20px rgba(0,0,0,0.2)` | Popovers, dropdowns, tooltips |
| `--box-shadow-large` | `0 15px 50px rgba(0,0,0,0.3)` | Modals |

In dark theme shadows darken and popovers add a `1px` border ring for separation.

### 3.4 Motion

| Token | Value |
|---|---|
| `--motion-productive-short` | `70ms` |
| `--motion-productive-medium` | `100ms` |
| `--motion-productive-long` | `150ms` |
| `--motion-expressive-short` | `250ms` |
| `--motion-expressive-long` | `400ms` |
| `--motion-timing-enter` | `cubic-bezier(0, 0, 0.35, 1)` |
| `--motion-timing-exit` | `cubic-bezier(0.4, 0, 1, 1)` |
| `--motion-timing-transition` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--motion-timing-emphasize` | `cubic-bezier(0, 0, 0.2, 1.4)` |

`--disabled-component-opacity: 0.38`

---

## 4. Layout & Grid

### 4.1 Responsive Breakpoints

| Breakpoint | Min width |
|---|---|
| Base | `< 1280px` |
| Large | `≥ 1280px` |
| XL | `≥ 1440px` |
| XXL | `≥ 1720px` |

### 4.2 App Shell

Standard three-region application layout:

```
┌──────────────────────────────────────────────────────────────┐
│  TOP BAR  (~48px)   logo · search · notifications · profile  │
├────────────┬─────────────────────────────────────────────────┤
│            │  PAGE HEADER  (title, tabs, view switcher)       │
│  LEFT NAV  ├─────────────────────────────────────────────────┤
│  (~230px,  │                                                 │
│  collapsible│              MAIN CONTENT AREA                  │
│  to ~60px) │           (tables, boards, dashboards)          │
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

| Region | Spec |
|---|---|
| Top bar height | `48px`; background `--primary-background-color`; bottom border `1px solid --layout-border-color` |
| Left nav width | expanded ≈ `230px`, collapsed ≈ `60px`; background `--primary-background-color`; right border `1px solid --layout-border-color` |
| Nav item | height `32–40px`, radius `--border-radius-small`, hover bg `--primary-background-hover-color`, active bg `--primary-selected-color` + text `--primary-color` |
| Main content | background `--grey-background-color` (`#f6f7fb`); content padding `--space-24` |
| Content width | fluid; use `--space-16` / `--space-24` gutters |

Build the shell with CSS Grid:
`grid-template-columns: auto 1fr; grid-template-rows: 48px 1fr;`

---

## 5. Buttons

Base radius `--border-radius-small` (4px); base font `--font-text2-normal` (xxs–small) or
`--font-text1-normal` (medium–large); `display:inline-flex`, centered. Active press:
`transform: scale(0.95)`. Icon gap: `--space-8`.

### 5.1 Sizes

| Size | Height | Padding | Font |
|---|---|---|---|
| `xxs` | 16px | `2px 4px` | text2 (14px) |
| `xs` | 24px | `4px 8px` | text2 |
| `small` | 32px | `4px 8px` | text2 |
| `medium` *(default)* | 40px | `8px 16px` | text1 (16px) |
| `large` | 48px | `12px 24px` | text1 |

### 5.2 Kinds

| Kind | Default | Hover | Notes |
|---|---|---|---|
| **Primary** | bg `--primary-color`, text `--text-color-on-primary` | bg `--primary-hover-color` | Main CTA |
| **Secondary** | transparent bg, `1px` border `--ui-border-color`, text `--primary-text-color` | bg `--primary-background-hover-color` | Default / outline |
| **Tertiary** | transparent bg + text, no border | bg `--primary-background-hover-color` | Low-emphasis / icon buttons |

### 5.3 Color variants (apply to any kind)

`primary` · `brand` · `positive` (`--positive-color`) · `negative` (`--negative-color`)
· `inverted` · `on-primary` · `on-inverted-background` · `fixed-light` · `fixed-dark`.
Each has an `-active` (selected/toggled) state.

### 5.4 States

- **Hover/focus:** background shifts to the `-hover` token.
- **Active (pressed):** `transform: scale(0.95)`.
- **Focus-visible:** `box-shadow: 0 0 0 3px hsla(209,100%,50%,0.5), 0 0 0 1px var(--primary-hover-color) inset;` (no plain outline). An inset-focus variant puts both rings inside.
- **Disabled:** primary → bg `--disabled-background-color`, text `--disabled-text-color`; secondary/tertiary → border/text `--disabled-text-color`; `cursor:not-allowed; pointer-events:none`.
- **Loading & success:** built-in loader swap and a success checkmark state.
- **Grouped:** square off adjoining corners (`leftFlat` / `rightFlat`) for button groups and split buttons.

---

## 6. Tabs

### 6.1 Tab List

- `display:flex; flex-direction:row; list-style:none; padding:0;`
- Height by size: **sm 32px · md 40px (default) · lg 48px**.
- `stretched` modifier → list and tabs grow to `width:100%`.
- `stretchedUnderline` modifier → a full-width `2px solid --ui-background-color` rail under all tabs.

### 6.2 Tab

- Wrapper: `border-bottom: 2px solid --ui-background-color` (the inactive rail);
  top border `1px solid transparent` to balance height.
- Inner: `padding: 4px 16px; font: --font-text1-normal; cursor:pointer; color:--primary-text-color;`
  `display:flex; align-items:center; justify-content:center;`
- Icon gap `--space-8` (leading or trailing); icon color `--icon-color`.
- **Active indicator:** an `::after` bar, `2px solid --primary-color`, animates
  `transform: scaleX(0) → scaleX(1)` over `--motion-productive-medium` with `--motion-timing-enter`.
- **Hover (non-disabled):** inner gets `background-color: --primary-background-hover-color; border-radius: 4px;`
- **Disabled:** text `--disabled-text-color; cursor:not-allowed;`
- **Focus-visible:** inset ring `0 0 0 3px hsla(209,100%,50%,0.5) inset, 0 0 0 1px --primary-hover-color inset;` radius `3px`.

### 6.3 Tab Panel

`color: --primary-text-color;` — unstyled container; the page owns the inner padding.

---

## 7. Popups, Modals, Dialogs, Tooltips, Toasts

### 7.1 Modal

Centered, fixed overlay.

- **Container:** `position:fixed; inset:0; z-index: var(--modal-z-index, 10000);`
- **Overlay:** `position:fixed; inset:0; background: --backdrop-color;` (`rgba(41,47,76,0.7)`).
- **Modal box:** `border-radius: --border-radius-big` (16px); `box-shadow: --box-shadow-large`;
  `background: --primary-background-color`; `display:flex; flex-direction:column; overflow:hidden;`
  centered via `top:50%; left:50%` + transform.
- **Inline padding token:** `--modal-inline-padding: --space-32`; top-action inset `--space-24`.

**Sizes** (width grows with viewport):

| Size | Max-height | Base width | ≥1280 | ≥1440 |
|---|---|---|---|---|
| `small` | 50% | 460px | 480px | 520px |
| `medium` | 80% | 540px | 580px | 620px |
| `large` | 80% | 800px | 840px | 900px |
| `fullView` | 100% | fluid, `inset:0`, `margin-inline:24px`, top offset `40px` | | |

**Animations:**
- Center pop — opens with `scale(0.8)→1` + fade over `150ms cubic-bezier(0,0,0.4,1)`; closes `100ms`.
- Anchor pop — grows from an anchor element's coordinates (`--modal-start-x/y`), `200ms`.
- Full view — slides up `translateY(30px)→0`, `250ms`.
- Overlay fades `opacity 100ms`.

**Structure:** Header (full-width, top-aligned; description icon uses `--icon-color`)
· Content · Footer (`padding: 20px --space-24`, `background --primary-background-color`,
`flex-shrink:0`). Footer supports a standard and a wizard variant.

### 7.2 Dialog / Popover

The generic floating surface behind dropdowns, menus, and tooltips-with-content.

| Variant | Style |
|---|---|
| Popover | `box-shadow: --box-shadow-medium; border-radius: --border-radius-medium` (8px); `background: --secondary-background-color`. Dark theme adds a `1px` border ring. |
| Modal-type | `box-shadow: --box-shadow-large; border-radius: --border-radius-big` (16px); `background: --primary-background-color`. |

Padding sizes: `small --space-8` · `medium --space-16` · `large --space-24`.
The dialog handles positioning, open/close triggers (click, hover, focus), and animation.

### 7.3 Menu (the dropdown list inside a popover)

- **Menu widths:** `small 200px · medium 220px · large 240px`. `padding:0; margin:0;`
- **Menu item:** `display:flex; flex-direction:row; align-items:center;`
  `padding: --space-4 --space-8; border: 1px solid transparent; cursor:pointer;`
- **Item title:** `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-grow:1;`
- **Hover/active:** background → `--primary-background-hover-color` (selected → `--primary-selected-color`).
- **Disabled:** `cursor:not-allowed`, reduced opacity.
- Supports leading icon, trailing sub-menu chevron, divider, and section title.
- Triggered via a menu button (a tertiary icon-button that opens the menu in a popover dialog).

### 7.4 Tooltip

- `background: --inverted-color-background` (`#323338` light); `color: --text-color-on-inverted`;
  `border-radius: --border-radius-small`; `box-shadow: --box-shadow-medium`; `font: --font-text2-normal`.
- `max-width: 240px`; `white-space:pre-wrap; word-break:break-word;`
- Content padding `--space-8 --space-16`; a medium variant uses `8px` radius + `--space-16`.
- Optional title (`--font-text2-bold`), image, arrow. A primary variant uses `--primary-color` bg.

### 7.5 Toast

Transient notification bar — success / error / normal types, optional action link and
close button. Positioned by the app (typically bottom-center), auto-dismiss with timer.

### 7.6 Z-index ladder

App chrome (low) → sticky headers → dropdowns/menus/popovers → tooltips →
**Modal `10000`** (via `--modal-z-index`) → toasts (above modal).

---

## 8. Form Controls

### 8.1 Text Field

`font: --font-text2-normal; width:100%; box-sizing:border-box;`

- **Input:** `background: --secondary-background-color; border: 1px solid --ui-border-color;`
  `border-radius: --border-radius-small; color: --primary-text-color;`
  `padding: --space-8 --space-4 --space-8 --space-12;`
  `transition: border-color --motion-productive-medium ease-in;`
- **Heights:** `small 32px · medium 40px · large 48px`.
- **Hover:** border-color → `--primary-text-color`.
- **Focus / active:** border-color → `--primary-color`.
- **Placeholder:** `--placeholder-color`, weight 400.
- **Error:** border + status text + icon → `--negative-color`.
- **Success:** border + status text + icon → `--positive-color`.
- **Disabled:** `background: --disabled-background-color; pointer-events:none; cursor:not-allowed;` placeholder → `--disabled-text-color`.
- **Read-only:** `background: --allgrey-background-color; border:none;`
- **Shape variants:** round (`border-radius:50px`), square (`0`), underline-only (bottom border only).
- Optional trailing icon container (`24px`, appears on state), char counter, label, sub-text/validation message.

### 8.2 Dropdown (select)

- **Trigger heights:** `small 32px · medium 40px · large 48px` (`min-height`).
- Inner input row `24px` in small; multi-select chips wrap with `padding: --space-4 0 --space-4 --space-8`.
- Closed trigger looks like a text field; open state renders a popover dialog containing a menu of options.
- Supports single/multi select, search, async, grouped options, custom option renderers.

### 8.3 Other inputs (same token rules)

Checkbox, radio button, toggle/switch, slider, search, textarea, number field, combobox,
date picker, color picker — all consume the same color/space/radius tokens.
Selected/checked state = `--primary-color`; disabled = `--disabled-*` tokens; focus = the
standard `0 0 0 3px hsla(209,100%,50%,0.5)` ring.

---

## 9. Interaction & State Rules (apply everywhere)

| State | Rule |
|---|---|
| **Hover** | Move to the `-hover` token, or overlay `--primary-background-hover-color` on transparent surfaces. |
| **Active / pressed** | Buttons `scale(0.95)`; icon-buttons `scale(0.9)`. |
| **Selected / toggled** | `--primary-selected-color` background, `--primary-color` text/border. |
| **Focus-visible** | `box-shadow: 0 0 0 3px hsla(209,100%,50%,0.5)` (+ optional `1px` inset of `--primary-hover-color`); never a plain outline. |
| **Disabled** | `--disabled-background-color` / `--disabled-text-color`, or `opacity:0.38`; `cursor:not-allowed; pointer-events:none`. |
| **Error / success** | Border + helper text + icon recolor to `--negative-color` / `--positive-color`. |
| **Transitions** | Use the motion tokens — `70–150ms` for productive UI, `250–400ms` for expressive/entrance. |

---

## 10. Full CSS Variables Reference

Drop this into a global stylesheet. Light theme on `:root`; dark overrides under
`.theme-dark` (apply the class to `<body>` or a wrapper).

```css
:root {
  /* Motion */
  --motion-productive-short: 70ms;
  --motion-productive-medium: 100ms;
  --motion-productive-long: 150ms;
  --motion-expressive-short: 250ms;
  --motion-expressive-long: 400ms;
  --motion-timing-enter: cubic-bezier(0, 0, 0.35, 1);
  --motion-timing-exit: cubic-bezier(0.4, 0, 1, 1);
  --motion-timing-transition: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-timing-emphasize: cubic-bezier(0, 0, 0.2, 1.4);

  /* Spacing */
  --space-2: 2px;  --space-4: 4px;  --space-8: 8px;  --space-12: 12px;
  --space-16: 16px; --space-20: 20px; --space-24: 24px; --space-32: 32px;
  --space-40: 40px; --space-48: 48px; --space-64: 64px; --space-80: 80px;

  /* Border */
  --border-width: 1px;
  --border-style: solid;
  --border-radius-small: 4px;
  --border-radius-medium: 8px;
  --border-radius-big: 16px;
  --disabled-component-opacity: 0.38;

  /* Z-index */
  --modal-z-index: 10000;

  /* Typography */
  --font-family: Figtree, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif;
  --title-font-family: Poppins, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif;
  --font-weight-very-light: 200;
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-bold: 500;
  --font-h1: 700 32px/40px var(--title-font-family);
  --font-h2: 700 24px/30px var(--title-font-family);
  --font-h3: 700 18px/24px var(--title-font-family);
  --font-text1-normal: 400 16px/22px var(--font-family);
  --font-text1-medium: 600 16px/22px var(--font-family);
  --font-text1-bold:   700 16px/22px var(--font-family);
  --font-text2-normal: 400 14px/20px var(--font-family);
  --font-text2-medium: 600 14px/20px var(--font-family);
  --font-text2-bold:   700 14px/20px var(--font-family);
  --font-text3-normal: 400 12px/16px var(--font-family);
  --font-text3-medium: 600 12px/16px var(--font-family);
  --font-text3-bold:   700 12px/16px var(--font-family);

  /* Primary / brand */
  --primary-color: #0073ea;
  --primary-hover-color: #0060b9;
  --primary-selected-color: #cce5ff;
  --primary-selected-hover-color: #aed4fc;
  --primary-highlighted-color: #f0f7ff;
  --primary-surface-color: #eceff8;
  --brand-color: #0073ea;
  --brand-hover-color: #0060b9;
  --link-color: #1f76c2;

  /* Text */
  --primary-text-color: #323338;
  --secondary-text-color: #676879;
  --text-color-on-primary: #ffffff;
  --text-color-on-inverted: #ffffff;
  --disabled-text-color: rgba(50, 51, 56, var(--disabled-component-opacity));
  --placeholder-color: #676879;
  --icon-color: #676879;

  /* Backgrounds & surfaces */
  --primary-background-color: #ffffff;
  --secondary-background-color: #ffffff;
  --allgrey-background-color: #f6f7fb;
  --grey-background-color: #f6f7fb;
  --primary-background-hover-color: rgba(103, 104, 121, 0.1);
  --disabled-background-color: #ecedf5;
  --modal-background-color: #ffffff;
  --dialog-background-color: #ffffff;
  --backdrop-color: rgba(41, 47, 76, 0.7);
  --inverted-color-background: #323338;

  /* Borders */
  --ui-border-color: #c3c6d4;
  --layout-border-color: #d0d4e4;
  --ui-background-color: #e7e9ef;
  --ui-background-hover-color: #d8d9e0;

  /* Status */
  --positive-color: #00854d;
  --positive-color-hover: #007038;
  --positive-color-selected: #bbdbc9;
  --negative-color: #d83a52;
  --negative-color-hover: #b63546;
  --negative-color-selected: #f4c3cb;
  --warning-color: #ffcb00;
  --warning-color-hover: #eaaa15;
  --warning-color-selected: #fceba1;

  /* Elevation */
  --box-shadow-xs: 0px 4px 6px -4px rgba(0, 0, 0, 0.1);
  --box-shadow-small: 0px 4px 8px rgba(0, 0, 0, 0.2);
  --box-shadow-medium: 0px 6px 20px rgba(0, 0, 0, 0.2);
  --box-shadow-large: 0px 15px 50px rgba(0, 0, 0, 0.3);
}

/* Dark theme — add class .theme-dark on <body> or a wrapper */
.theme-dark {
  --primary-selected-color: #133774;
  --primary-selected-hover-color: #0d2e65;
  --primary-highlighted-color: #0d2753;
  --primary-surface-color: #181b34;
  --primary-text-color: #d5d8df;
  --secondary-text-color: #9699a6;
  --text-color-on-inverted: #323338;
  --inverted-color-background: #ffffff;
  --primary-background-color: #181b34;
  --secondary-background-color: #30324e;
  --allgrey-background-color: #30324e;
  --grey-background-color: #181b34;
  --primary-background-hover-color: rgba(103, 104, 121, 0.3);
  --disabled-background-color: #3c3f59;
  --modal-background-color: #181b34;
  --dialog-background-color: #30324e;
  --ui-border-color: #797e93;
  --layout-border-color: #4b4e69;
  --ui-background-color: #434660;
  --placeholder-color: #c3c6d4;
  --icon-color: #c3c6d4;
  --link-color: #69a7ef;
  --box-shadow-xs: 0px 4px 6px -4px rgba(9, 11, 25, 0.5);
  --box-shadow-small: 0px 4px 8px rgba(9, 11, 25, 0.5);
  --box-shadow-medium: 0px 6px 20px rgba(9, 11, 25, 0.5);
  --box-shadow-large: 0px 15px 50px rgba(9, 11, 25, 0.5);
}
```

---

## 11. Component Inventory

Every page should be assembled from this standard component set. Build each one once,
reuse everywhere.

- **Buttons:** Button, ButtonGroup, SplitButton, MenuButton, IconButton, Chips
- **Inputs:** TextField, TextArea, NumberField, Search, Checkbox, RadioButton, Toggle/Switch, Slider, Dropdown, Combobox, DatePicker, ColorPicker, EditableText, EditableHeading
- **Navigation:** Tabs (TabList / Tab / TabPanel), Breadcrumbs, Steps, MultiStepIndicator, MenuButton
- **Overlays / feedback:** Modal, Dialog, Tooltip, Toast, AttentionBox, AlertBanner, Coachmark/Tipseen, Skeleton, Loader, ProgressBar
- **Data display:** Table, List, Menu, Accordion, Avatar, AvatarGroup, Badge, Counter, Label, Divider, ExpandCollapse, EmptyState
- **Layout / theming:** Flex/layout primitives, ThemeProvider, Divider, VirtualizedList, VirtualizedGrid
- **Typography:** Heading, Text
- **Media:** Icon, Avatar, Clickable

---

## 12. Build Checklist

Before any UI code is considered done:

- [ ] All colors, spacing, radius, fonts, shadows, motion use tokens — no raw values.
- [ ] Component matches the size, padding, and structure specs above.
- [ ] Hover, active, selected, focus-visible, and disabled states are all implemented.
- [ ] Error and success states implemented where the component accepts input.
- [ ] Works in both light and `.theme-dark` with no hard-coded colors.
- [ ] Layout sits on the 4px grid and respects the responsive breakpoints.
- [ ] Transitions use the motion tokens, not arbitrary durations.
- [ ] New screens are assembled from the standard component inventory, not one-offs.
