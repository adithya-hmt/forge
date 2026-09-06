# Forge UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forge feel like a focused intelligence workspace by simplifying navigation, turning Research into a list/detail decision flow, and reducing panel/chip/debug visual noise without changing backend behavior.

**Architecture:** Keep the existing React/Vite application, Forge store, view types, scoring, research, OAuth, persistence, and safety flows unchanged. Implement the redesign as presentation-layer changes in shared UI primitives, chrome, and primary screens; derive selected-result state locally inside Research and use existing `ForgeApi` actions for navigation and preparation.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS v4, Phosphor Icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-forge-uiux-redesign-design.md`

## Global Constraints

- Preserve all backend/data behavior; do not edit Supabase migrations, Edge Functions, OAuth, persistence adapters, research algorithms, or scoring algorithms.
- Primary navigation has exactly three daily-work items: Research, Opportunities, Workspaces.
- Utility navigation keeps Evidence, Activity/Jobs, and Settings reachable.
- Phosphor remains the single general UI icon set.
- Ember is reserved for primary action, selection, and priority.
- Important UI text must not be smaller than 11px; diagnostic metadata may be 10–11px monospace.
- Calendar confirmation, Gmail draft-only behavior, and locked browser submission remain unchanged.
- Mobile layouts must not depend on horizontally squeezed tables.
- Existing tests plus `npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run build` must pass.

---

### Task 1: Establish quieter shared UI primitives and visual tokens

**Files:**
- Modify: `src/index.css`
- Modify: `src/ui.tsx`
- Test: `test/ui-contract.test.ts`

**Interfaces:**
- Consumes: existing `Icon`, `Panel`, `Meter`, `StatusPill`, `EmptyState` APIs.
- Produces: `Surface`, `Section`, `Toolbar`, and quieter default `Panel`; shared CSS classes `.surface`, `.section-heading`, `.toolbar`, `.split-shell`, `.result-row`, `.result-row-selected`, `.meta-line`, `.mobile-action-bar`.

- [ ] **Step 1: Write the failing UI contract test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const css = fs.readFileSync("src/index.css", "utf8");
const ui = fs.readFileSync("src/ui.tsx", "utf8");

describe("redesign UI contracts", () => {
  it("defines quiet workspace primitives", () => {
    for (const token of [".surface", ".section-heading", ".toolbar", ".split-shell", ".result-row-selected"]) {
      expect(css).toContain(token);
    }
    expect(ui).toContain("export function Surface");
    expect(ui).toContain("export function Section");
    expect(ui).toContain("export function Toolbar");
  });

  it("removes panel ticks from the default Panel treatment", () => {
    expect(ui).not.toContain("ticks = true");
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run test/ui-contract.test.ts`
Expected: FAIL because the new primitives/classes do not exist yet.

- [ ] **Step 3: Implement the primitives and quieter visual system**

Implement in `src/ui.tsx`:

```tsx
export function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`surface ${className}`}>{children}</section>;
}

export function Section({ title, description, action, children, className = "" }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-block ${className}`}>
      <header className="section-heading">
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action && <div>{action}</div>}
      </header>
      {children}
    </section>
  );
}

export function Toolbar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`toolbar ${className}`}>{children}</div>;
}
```

Update `Panel` so corner ticks are opt-in rather than default, and update CSS to:
- remove ambient grid from normal content areas
- use softer borders and 8–10px radius
- remove uppercase/letter spacing from `.btn`
- make `.lbl` minimum 11px when used as visible product labels
- add the listed split/list/mobile classes
- add a `prefers-reduced-motion` block disabling nonessential animations.

- [ ] **Step 4: Run UI contract + existing unit tests**

Run: `npx vitest run test/ui-contract.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/ui.tsx test/ui-contract.test.ts
git commit -m "refactor(ui): simplify Forge visual primitives"
```

---

### Task 2: Simplify global navigation and top bar

**Files:**
- Modify: `src/chrome.tsx`
- Test: `test/navigation-contract.test.ts`

**Interfaces:**
- Consumes: existing `View`, `useForge`, `CommandPalette`, notification behavior.
- Produces: three primary sidebar destinations (`command`, `search`, `workspace`) plus utility destinations (`evidence`, `jobs`, `settings`).

- [ ] **Step 1: Write the failing navigation contract test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const chrome = fs.readFileSync("src/chrome.tsx", "utf8");

describe("Forge navigation hierarchy", () => {
  it("uses Research, Opportunities, Workspaces as primary navigation", () => {
    expect(chrome).toContain('label: "Research"');
    expect(chrome).toContain('label: "Opportunities"');
    expect(chrome).toContain('label: "Workspaces"');
  });

  it("does not persist source diagnostics in the sidebar", () => {
    expect(chrome).not.toContain("Evidence coverage");
    expect(chrome).not.toContain("Crawl epoch");
  });

  it("does not expose Re-crawl as a global topbar action", () => {
    expect(chrome).not.toContain('title="Background monitor: re-fetch sources, diff snapshots"');
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run test/navigation-contract.test.ts`
Expected: FAIL on current labels/diagnostics.

- [ ] **Step 3: Rework sidebar and topbar**

Change `NAV` to two groups:

```ts
const NAV = [
  { section: "Workspace", items: [
    { label: "Research", icon: "search", view: { name: "command" }, kbd: "1" },
    { label: "Opportunities", icon: "radar", view: { name: "search" }, kbd: "2" },
    { label: "Workspaces", icon: "briefcase", view: { name: "workspace", oppId: "" }, kbd: "3" },
  ]},
  { section: "Utilities", items: [
    { label: "Evidence", icon: "graph", view: { name: "evidence" }, kbd: "4" },
    { label: "Activity", icon: "terminal", view: { name: "jobs" }, kbd: "5" },
    { label: "Settings", icon: "gear", view: { name: "settings" }, kbd: "6" },
  ]},
];
```

Remove persistent provider/source/crawl/evidence diagnostics from the sidebar footer. Keep only a compact warning/status line when `sourceMode !== "live"` or `persistenceKind !== "supabase"`.

Topbar: page title, command palette trigger, notifications, theme, profile. Remove global counts/epoch and Re-crawl.

Update command palette navigation labels to match the new IA.

- [ ] **Step 4: Run navigation test and unit suite**

Run: `npx vitest run test/navigation-contract.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chrome.tsx test/navigation-contract.test.ts
git commit -m "refactor(ui): focus Forge navigation"
```

---

### Task 3: Rebuild Research as a focused goal-to-decision workspace

**Files:**
- Modify: `src/screens/Command.tsx`
- Test: `test/research-ui-contract.test.ts`

**Interfaces:**
- Consumes: `f.runResearch(goal)`, `f.matches`, `f.opportunities`, `f.running`, `f.jobs`, `f.preparePlan`, `f.setView`, `f.compareTop`.
- Produces: local `selectedId: string | null`; desktop list/detail split; compact pipeline inspector; keyboard result navigation.

- [ ] **Step 1: Write the failing Research contract test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
const source = fs.readFileSync("src/screens/Command.tsx", "utf8");

describe("Research workspace", () => {
  it("uses a decision-oriented research headline and split result layout", () => {
    expect(source).toContain("What are you trying to win next?");
    expect(source).toContain("split-shell");
    expect(source).toContain("Why this fits");
    expect(source).toContain("Strong evidence");
    expect(source).toContain("Missing evidence");
    expect(source).toContain("Risk");
  });

  it("keeps detailed pipeline output behind Inspect run", () => {
    expect(source).toContain("Inspect run");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run test/research-ui-contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement initial/running/completed Research states**

Replace the two-column dashboard with:
- centered 860px goal entry before results
- short readiness sentence instead of readiness/weights/source cards
- compact running stage strip with `Inspect run` details disclosure
- after results, `.split-shell` containing ranked list and selected preview.

Local selection behavior:

```ts
const [selectedId, setSelectedId] = useState<string | null>(null);
const selected = results.find(({ opp }) => opp.id === selectedId) ?? results[0] ?? null;
useEffect(() => {
  if (!selectedId && results[0]) setSelectedId(results[0].opp.id);
}, [results, selectedId]);
```

Rows show rank, title, org, category/remote, deadline, fit, and one concise reason derived from highest scoring dimension / first gap. Preview shows `Why this fits`, `Strong evidence`, `Missing evidence`, `Risk`, then `Prepare me` and `Open details`.

Add keydown handling on the result region for ArrowUp/ArrowDown/Enter and `p`/`P`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/research-ui-contract.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Command.tsx test/research-ui-contract.test.ts
git commit -m "feat(ui): redesign Research decision flow"
```

---

### Task 4: Redesign Opportunity detail around decision, proof, and next action

**Files:**
- Modify: `src/screens/Opportunity.tsx`
- Test: `test/opportunity-ui-contract.test.ts`

**Interfaces:**
- Consumes: existing opportunity/match fields, provenance modal API, `preparePlan`, `setOutcome`, `setView`.
- Produces: sticky decision header; simplified proof rows with disclosure; top-gap-first presentation; sticky decision rail.

- [ ] **Step 1: Write the failing Opportunity contract test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
const source = fs.readFileSync("src/screens/Opportunity.tsx", "utf8");

describe("Opportunity decision workspace", () => {
  it("centers the screen around decision summary, proof and top gap", () => {
    expect(source).toContain("Decision summary");
    expect(source).toContain("Requirement coverage");
    expect(source).toContain("Fastest credible next step");
    expect(source).toContain("Verified facts");
  });

  it("does not render every outcome as a row of chips", () => {
    expect(source).not.toContain("OUTCOMES.map");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run test/opportunity-ui-contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the decision workspace**

Header: back to results, title/org, deadline, fit, Save, Prepare/Open Workspace. Replace the outcome chip strip with a compact `<select>`/menu bound to existing `setOutcome`.

Main layout: `minmax(0,1fr) 320px` on desktop.

Main column:
- `Requirement coverage`: each proof row has requirement, strength, best evidence, concise gap; use `<details>` for all evidence.
- `Fastest credible next step`: render `match?.gaps[0]` prominently, additional gaps behind disclosure.
- `Verified facts`: compact facts rows opening provenance.

Right rail: sticky `Decision summary`, fit score, confidence/EV, 3 strongest/weakest dimensions, primary actions.

Mobile: stack sections; proof rows become cards, never a four-column table.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/opportunity-ui-contract.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Opportunity.tsx test/opportunity-ui-contract.test.ts
git commit -m "feat(ui): turn opportunity detail into decision workspace"
```

---

### Task 5: Unify opportunity browsing and quiet the workspace hierarchy

**Files:**
- Modify: `src/screens/Search.tsx`
- Modify: `src/screens/Radar.tsx`
- Modify: `src/screens/Workspace.tsx`
- Test: `test/workflow-ui-contract.test.ts`

**Interfaces:**
- Consumes: existing search/filter state and workspace safety actions.
- Produces: shared list/table visual language; calmer workspace plan hierarchy; unchanged safety callbacks.

- [ ] **Step 1: Write the failing workflow contract test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
const search = fs.readFileSync("src/screens/Search.tsx", "utf8");
const workspace = fs.readFileSync("src/screens/Workspace.tsx", "utf8");

describe("secondary workflow redesign", () => {
  it("uses a compact opportunities toolbar", () => {
    expect(search).toContain("Opportunity filters");
    expect(search).toContain("toolbar");
  });

  it("preserves explicit calendar confirmation and locked browser submission", () => {
    expect(workspace).toContain("Confirm calendar changes");
    expect(workspace).toContain("Final submission — locked");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run test/workflow-ui-contract.test.ts`
Expected: FAIL on the new toolbar contract while safety assertions remain green.

- [ ] **Step 3: Simplify Search/Radar and Workspace presentation**

Search: compact `Toolbar` containing query + filters, followed by a clean list/table of title/org, fit, deadline, status, category. Radar: reuse the same row visual language and reduce large section cards; treat radar groups as saved views.

Workspace: preserve tabs and all callbacks. Make Plan dominant; reduce milestone visual weight; make task rows 40px+ with title/rationale left and due/effort right; move documents/contacts into a quieter side rail/disclosure. Do not change Calendar modal, Gmail draft path, or Browser locked-submit behavior.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/workflow-ui-contract.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Search.tsx src/screens/Radar.tsx src/screens/Workspace.tsx test/workflow-ui-contract.test.ts
git commit -m "refactor(ui): unify Forge browsing and workspace hierarchy"
```

---

### Task 6: Full verification and responsive polish

**Files:**
- Modify as required by failures: `src/index.css`, primary screen files, contract tests.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified redesign branch ready for review.

- [ ] **Step 1: Run full automated verification**

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Start the built app locally and inspect key routes/states**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Verify at a minimum:
- Research initial state has one dominant CTA.
- Running state exposes compact progress and optional logs.
- Completed state is list/detail without layout jumps.
- Opportunity detail surfaces fit, deadline, strongest proof, largest gap, and Prepare Me immediately.
- Workspace still requires calendar confirmation, never sends Gmail, and keeps browser submit locked.
- 375px layout has no horizontal overflow.
- Dark and light themes retain contrast.

- [ ] **Step 3: Fix any visual/behavioral regressions and rerun relevant tests**

For each regression, add or tighten a contract/unit test first where the behavior can be automated, verify it fails, make the minimal fix, then rerun the focused test.

- [ ] **Step 4: Run final verification again**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

Expected: exit 0.

- [ ] **Step 5: Commit final polish**

```bash
git add src test
git commit -m "fix(ui): finish Forge responsive redesign"
```

## Self-review

- Spec coverage: Research, navigation, Opportunity, Workspaces, Search/Radar, typography, density, responsiveness, accessibility, motion, and safety-preservation each have an implementation task.
- No backend/data-contract files are included in planned modifications.
- Every production behavior task starts with a failing contract test and a RED verification step.
- Final verification includes all existing required commands and a running-app review.
