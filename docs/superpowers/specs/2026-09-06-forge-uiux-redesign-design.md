# Forge UI/UX Redesign — Design

Date: 2026-09-06
Branch: `uiux-redesign`
Status: Awaiting user review

## Goal

Redesign Forge so the product feels like a focused intelligence workspace rather than a dense AI-generated dashboard. Preserve backend behavior, data structures, research logic, OAuth/persistence behavior, and existing navigation destinations while improving hierarchy, scanability, decision speed, and mobile usability.

The primary user loop must become visually obvious:

1. State a goal.
2. Run research.
3. Compare ranked opportunities.
4. Open one opportunity.
5. Understand fit, evidence, and gaps.
6. Prepare an execution plan.

## Design direction

Use a restrained "Linear × Raycast × Arc" direction:

- dark technical identity remains, but with calmer surfaces
- fewer bordered panels and fewer decorative status elements
- one dominant workspace per screen
- stronger typography hierarchy and more whitespace around primary decisions
- compact secondary metadata rather than many chips
- persistent context rather than repeated dashboard cards
- orange/ember is reserved for actions and priority, not decoration
- Phosphor remains the single general UI icon set

Do not introduce gradients, glassmorphism, excessive shadows, or large decorative illustrations.

## Problems in the current UI

### 1. Too many equally-weighted surfaces

`Panel` is used for almost every content group. Combined with panel corner ticks, borders, chips, labels, and status pills, the UI makes primary and secondary information compete visually.

### 2. Command screen has three jobs at once

The current Command screen simultaneously acts as:

- a goal input
- pipeline debugger
- ranked-results view
- profile readiness dashboard
- scoring-weight dashboard
- source adapter status dashboard

The user has no single focal task.

### 3. Ranked results hide the comparison task

Results are expandable rows containing many details and actions. The important decision — "which opportunity should I choose?" — is buried under inline metrics and expansion state.

### 4. Opportunity detail is overloaded

The screen places metadata, outcomes, proof matrix, gap closer, fit breakdown, provenance, history, and actions into many panels. The most important elements — fit, requirements, biggest gap, deadline, and Prepare Me — are not dominant enough.

### 5. Global navigation exposes internal/system screens too prominently

Jobs & Evals, Evidence Graph, source adapters, crawl epoch, weights, and system information are useful but should not compete with Research, Opportunities, and Workspaces in daily use.

### 6. Excessive microcopy and micro-labeling

Many 9–10px uppercase labels, chips, counters, and monospace metadata make the interface feel like a debug console. Some of this should remain for provenance/research detail, but it should be progressive disclosure.

## Information architecture

### Primary navigation

Sidebar primary items:

- Research
- Opportunities
- Workspaces

Secondary utility section:

- Evidence
- Activity / Jobs
- Settings

The sidebar should be approximately 232px on desktop and collapsible on smaller widths.

Remove source-provider diagnostics, crawl epoch, evidence coverage, and storage status from the persistent sidebar. Move system status into Settings/System and surface a compact warning only when something requires action.

### Top bar

Keep top bar simple:

- current page title / breadcrumb
- command/search trigger
- notification button
- profile/menu

Do not show opportunity count, ranked count, crawl epoch, or Re-crawl globally. Re-crawl belongs in Research or Opportunity context.

## Screen 1 — Research

Research replaces the current overloaded Command presentation.

### Empty / initial state

The page uses a narrow centered column (max width roughly 860px).

Top content:

- small Forge eyebrow: `Opportunity intelligence`
- headline: `What are you trying to win next?`
- one large goal input
- primary `Research` button
- three short presets below as plain text suggestions, not large chips

Below the input, show one compact readiness sentence, e.g.:

`GitHub connected · Resume missing · Live sources enabled`

Each incomplete item can link to Settings.

Do not show weight controls, source-adapter details, or pipeline internals here before a run starts.

### Running state

Keep the user on the same page.

Replace the large debug panel with a compact progress header:

`Researching 3 sources · Verifying deadlines · 18s`

Under it, show the 8 pipeline stages as a thin horizontal progress sequence. Show detailed logs only behind an `Inspect run` disclosure.

The main page should not scroll a terminal log automatically while the user is waiting.

### Completed state

Transition the same page into a results workspace:

Desktop layout:

- left: ranked opportunity list (~42%)
- right: selected opportunity preview (~58%)

The top-ranked item is selected by default.

## Ranked opportunity list

Each row shows only:

- rank
- title
- organization
- category / remote label
- deadline or `rolling`
- Fit score
- one short reason, e.g. `Strong React evidence · deadline feasible`

Do not show prize, source count, confidence, EV, changed status, meters, and multiple chips simultaneously unless relevant.

Selected row gets a clear background and left indicator.

Keyboard support:

- ↑ / ↓ changes selection
- Enter opens full opportunity
- `P` prepares selected opportunity

## Opportunity preview pane

The preview answers four questions in order:

1. Why is this ranked here?
2. What do I have?
3. What am I missing?
4. What should I do next?

Header:

- title + organization
- deadline
- fit score
- verified/conflicting state only if meaningful

Primary insight block:

`Why this fits`

Use 2–3 sentences generated from existing deterministic score explanations.

Then display three compact columns/rows:

- Strong evidence
- Missing evidence
- Risk

Primary CTA: `Prepare me`
Secondary CTA: `Open details`

Do not place every scoring dimension in the preview.

## Screen 2 — Opportunity detail

Opportunity detail becomes a single decision workspace rather than a dashboard.

### Sticky header

Include:

- back to results
- opportunity title / organization
- deadline
- Fit
- Save
- Prepare Me / Open Workspace

Outcome tracking moves into a small overflow/status control rather than rendering every outcome as a chip.

### Main layout

Desktop two-column layout:

Main column (~68%):

1. Requirement → Proof
2. Gap closer
3. Source facts / provenance

Right rail (~32%, sticky):

1. Decision summary
2. Fit components
3. Deadline / compensation / location
4. Primary actions

### Requirement → Proof

This remains the flagship element but should be simplified.

Use rows or compact cards instead of a dense four-column table on all screen widths.

Each requirement shows:

- requirement title
- strength indicator
- best supporting artifact
- concise gap, if any

Expand a row to view all evidence and confidence details.

Default view should make strong/weak coverage obvious in under five seconds.

### Gap closer

Show only the top recommended gap action first.

Card contains:

- action title
- effort
- impact
- evidence produced
- `Add to plan`

Other gap actions live behind `Show more`.

### Provenance

Source provenance is important but secondary. Present a compact `Verified facts` section with deadline, eligibility, compensation, and source status. Clicking a fact opens the existing provenance modal.

## Screen 3 — Workspaces

Do not substantially redesign workflow behavior, but improve hierarchy:

- opportunity header remains compact
- tabs remain: Plan, Application, Calendar, Email, Browser agent, Activity
- Plan becomes the default dominant view
- milestone strip becomes quieter
- task rows become larger and clearer with due date / effort in a right-aligned metadata group
- supporting panels such as documents/contacts collapse into a right rail or disclosure

Application, Calendar, Email, and Browser Agent should keep all current safety behavior.

## Screen 4 — Opportunities

Merge the conceptual roles of current Search/Radar where practical without changing routing/data behavior immediately.

Present a searchable table/list with:

- title / organization
- fit
- deadline
- status
- category

Filters live in a compact toolbar, not a collection of cards.

Radar-specific sections can remain accessible as saved views/filter presets rather than a separate dashboard-heavy experience.

For this redesign pass, routes may remain separate internally, but both should use the same list primitives and visual language.

## System screens

Evidence, Jobs/Evals, Settings should remain functional but use a lower-emphasis utility style.

They do not need the same amount of visual polish as Research and Opportunity, but they must inherit:

- spacing tokens
- typography
- button styles
- simplified panels
- consistent empty/error/loading states

## Component changes

### `Panel`

Keep for genuinely bounded content only.

Remove corner ticks by default. Introduce quieter primitives:

- `Surface`
- `Section`
- `Divider`
- `Toolbar`

Do not wrap every section in a bordered card.

### Buttons

Three levels only:

- primary: ember fill
- secondary: neutral border
- tertiary: text/ghost

Remove uppercase/letter-spaced styling from most buttons. Buttons should read like product actions, not terminal commands.

### Chips / badges

Reserve badges for status/category information. Avoid using badges for prose, filters, metrics, and every metadata field.

### Typography

Use Space Grotesk for major headings and IBM Plex Sans for primary interface text. IBM Plex Mono is reserved for:

- provenance hashes
- job IDs
- source metadata
- keyboard shortcuts
- technical diagnostics

Normal dates, counts, and button labels should not default to monospace.

Suggested scale:

- page title: 28–32px
- section title: 16–18px
- row title: 14–15px
- body: 13–14px
- supporting metadata: 11–12px
- diagnostic metadata: 10–11px mono

Avoid important content below 11px.

## Color and visual density

Keep the existing neutral dark palette, but soften borders and remove ambient grid/noise from content-heavy areas.

Rules:

- ember = selected/primary/action
- green = verified/success
- amber = conflict/risk
- red = destructive/error
- steel = secondary informational state

Do not use color to decorate neutral metadata.

Light theme must remain supported.

## Motion

Retain subtle entrance and progress transitions.

Remove scanline effects and repeated stagger animations from dense lists. Respect `prefers-reduced-motion`.

## Responsive behavior

### Desktop ≥ 1200px

Use split panes for research results and opportunity detail.

### Tablet 768–1199px

Sidebar collapses. Result list opens preview/detail as a full-width secondary view.

### Mobile < 768px

Use bottom-safe primary actions and simple stacked layouts.

Do not horizontally squeeze wide proof tables. Requirement rows become cards/disclosures.

## Accessibility

- visible keyboard focus states
- minimum practical touch target around 40px for primary controls
- do not communicate verification state by color alone
- preserve keyboard command palette
- all icon-only buttons require accessible labels
- modal focus behavior must remain intact

## Files expected to change

Primary:

- `src/index.css`
- `src/ui.tsx`
- `src/chrome.tsx`
- `src/screens/Command.tsx`
- `src/screens/Opportunity.tsx`
- `src/screens/Search.tsx`
- `src/screens/Radar.tsx`
- `src/screens/Workspace.tsx`

Possible supporting changes:

- `src/App.tsx`
- small additions to `src/lib/types.ts` only if needed for UI state; no backend/data-contract changes

Do not change Supabase migrations, Edge Functions, OAuth, research algorithms, persistence adapters, or scoring algorithms as part of this UI/UX pass.

## Testing and acceptance criteria

Run existing checks after implementation:

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`

Manually verify these flows in the running app:

### Research flow

- first load has one clear primary CTA
- research can be started by mouse and keyboard
- running state communicates progress without dominating the screen
- result list is scannable at a glance
- selecting results does not cause layout jumps
- primary action is obvious

### Opportunity flow

- fit, deadline, strongest proof, biggest gap, and Prepare Me are visible without hunting
- detailed provenance remains one click away
- proof matrix works on desktop and mobile

### Workspace flow

- tasks remain editable/completable
- Calendar confirmation behavior is unchanged
- Gmail draft safety behavior is unchanged
- browser submission remains locked

### Navigation

- primary nav has no more than three daily-work items
- utility screens remain reachable
- command palette still works

### Visual quality

- no panel-tick decoration in normal content
- no important text below 11px
- status chips are used sparingly
- no horizontal overflow at 375px viewport width
- light and dark modes remain readable

## Non-goals

This pass does not:

- migrate Vite to Next.js
- change backend architecture
- add new opportunity sources
- modify OAuth
- change scoring
- complete unfinished production infrastructure
- add new product capabilities

The redesign is successful if Forge feels significantly easier to understand and operate while preserving all existing behavior.