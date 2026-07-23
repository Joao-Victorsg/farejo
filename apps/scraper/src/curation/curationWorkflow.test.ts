import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows");
const CANDIDATES_WORKFLOW_PATH = resolve(WORKFLOWS_DIR, "curation-candidates.yml");
const APPLY_WORKFLOW_PATH = resolve(WORKFLOWS_DIR, "curation-apply.yml");

describe("curation-candidates workflow (F3/T13, #59)", () => {
  it("never enables GitHub's auto-merge on the review pull request", async () => {
    const workflow = await readFile(CANDIDATES_WORKFLOW_PATH, "utf8");

    expect(workflow).not.toMatch(/auto-merge/i);
    expect(workflow).not.toMatch(/--auto\b/);
    expect(workflow).not.toMatch(/gh pr merge/);
  });

  it("only opens/updates a pull request, never pushes straight to master", async () => {
    const workflow = await readFile(CANDIDATES_WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/gh pr create/);
    expect(workflow).toMatch(/--base master/);
    expect(workflow).not.toMatch(/push[^\n]*origin master/);
  });

  it("has no scheduled cron trigger — manual review cadence only", async () => {
    const workflow = await readFile(CANDIDATES_WORKFLOW_PATH, "utf8");

    expect(workflow).not.toMatch(/schedule:/);
    expect(workflow).toMatch(/workflow_dispatch:/);
  });

  it("opens the review PR when the generator found candidates, even if the manifest stays unchanged", async () => {
    const workflow = await readFile(CANDIDATES_WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/id: generate-candidates/);
    expect(workflow).toMatch(/if: steps\.generate-candidates\.outputs\.candidate_count != '0'/);
    expect(workflow).toMatch(/git status --porcelain -- curation\/aliases-manifest\.json curation\/candidates-report\.md/);
  });
});

describe("curation-apply workflow (F3/T13, #59)", () => {
  it("uses the dedicated curation environment for its production credential", async () => {
    const workflow = await readFile(APPLY_WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/^\s{4}environment: curation$/m);
  });
});
