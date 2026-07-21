import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/scrape.yml");

describe("Scrape cashback workflow", () => {
  it("runs every job on the Node major required by the repository", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");
    const nodeVersions = [...workflow.matchAll(/node-version:\s*(\d+)/gu)].map((match) => match[1]);

    expect(nodeVersions).toHaveLength(8);
    expect(new Set(nodeVersions)).toEqual(new Set(["24"]));
  });

  it("captures the public Webfones response only in a directed cuponomia-tail dispatch", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/github\.event_name == 'workflow_dispatch'.*inputs\.target == 'cuponomia-tail'/u);
    expect(workflow).toMatch(/webfones-metadata\.json/u);
    expect(workflow).toMatch(/webfones\.html/u);
    expect(workflow).toMatch(/actions\/upload-artifact@v4/u);
    expect(workflow).not.toMatch(/\.artifacts\/cuponomia-webfones/u);
    expect(workflow).toMatch(/AbortSignal\.timeout\(10_000\)/u);

    const browserInstalls = workflow.match(/pnpm --filter @farejo\/scraper exec playwright install chromium --with-deps/gu);
    expect(browserInstalls).toHaveLength(2);
    expect(workflow.match(/  cuponomia-active:[\s\S]*?\n  cuponomia-tail:/u)?.[0]).toMatch(
      /playwright install chromium --with-deps/u,
    );
    expect(workflow.match(/  cuponomia-tail:[\s\S]*?\n  meliuz-active:/u)?.[0]).toMatch(
      /playwright install chromium --with-deps/u,
    );
  });
});
