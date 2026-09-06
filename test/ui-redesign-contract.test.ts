import { describe, expect, it } from "vitest";
import fs from "node:fs";

const css = fs.readFileSync("src/index.css", "utf8");
const ui = fs.readFileSync("src/ui.tsx", "utf8");
const chrome = fs.readFileSync("src/chrome.tsx", "utf8");
const research = fs.readFileSync("src/screens/Command.tsx", "utf8");
const opportunity = fs.readFileSync("src/screens/Opportunity.tsx", "utf8");
const search = fs.readFileSync("src/screens/Search.tsx", "utf8");
const workspace = fs.readFileSync("src/screens/Workspace.tsx", "utf8");

describe("Forge UI redesign contracts", () => {
  it("defines quiet workspace primitives", () => {
    for (const token of [".surface", ".section-heading", ".toolbar", ".split-shell", ".result-row-selected", ".meta-line"]) {
      expect(css).toContain(token);
    }
    expect(ui).toContain("export function Surface");
    expect(ui).toContain("export function Section");
    expect(ui).toContain("export function Toolbar");
    expect(ui).not.toContain("ticks = true");
  });

  it("uses focused primary navigation", () => {
    expect(chrome).toContain('label: "Research"');
    expect(chrome).toContain('label: "Opportunities"');
    expect(chrome).toContain('label: "Workspaces"');
    expect(chrome).not.toContain("Evidence coverage");
    expect(chrome).not.toContain("Crawl epoch");
    expect(chrome).not.toContain('title="Background monitor: re-fetch sources, diff snapshots"');
  });

  it("turns Research into a goal-to-decision workspace", () => {
    expect(research).toContain("What are you trying to win next?");
    expect(research).toContain("split-shell");
    expect(research).toContain("Why this fits");
    expect(research).toContain("Strong evidence");
    expect(research).toContain("Missing evidence");
    expect(research).toContain("Risk");
    expect(research).toContain("Inspect run");
  });

  it("turns Opportunity into a decision workspace", () => {
    expect(opportunity).toContain("Decision summary");
    expect(opportunity).toContain("Requirement coverage");
    expect(opportunity).toContain("Fastest credible next step");
    expect(opportunity).toContain("Verified facts");
    expect(opportunity).not.toContain("OUTCOMES.map");
  });

  it("keeps browsing compact and preserves irreversible-action safety", () => {
    expect(search).toContain("Opportunity filters");
    expect(search).toContain("toolbar");
    expect(workspace).toContain("Confirm calendar changes");
    expect(workspace).toContain("Final submission — locked");
  });

  it("includes reduced-motion support", () => {
    expect(css).toContain("prefers-reduced-motion");
  });
});
