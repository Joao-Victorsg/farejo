import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows/curation-candidates.yml");

describe("curation-candidates workflow (F3/T13, #59)", () => {
  it("never enables GitHub's auto-merge on the review pull request", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).not.toMatch(/auto-merge/i);
    expect(workflow).not.toMatch(/--auto\b/);
    expect(workflow).not.toMatch(/gh pr merge/);
  });

  it("only opens/updates a pull request, never pushes straight to master", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/gh pr create/);
    expect(workflow).toMatch(/--base master/);
    expect(workflow).not.toMatch(/push[^\n]*origin master/);
  });

  it("has no scheduled cron trigger — manual review cadence only", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).not.toMatch(/schedule:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
  });
});
