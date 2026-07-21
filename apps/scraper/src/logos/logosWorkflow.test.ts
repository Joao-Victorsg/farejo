import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows/logos.yml");

describe("logos workflow (F3/T15, #61, ADR-0042)", () => {
  it("never touches service_role, farejo_web or curation secrets", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).not.toMatch(/FAREJO_CURATION_DATABASE_URL/);
    expect(workflow).not.toMatch(/FAREJO_WEB/);
  });

  it("uses a dedicated database role and S3 credential, separate from the rest of the pipeline", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/FAREJO_LOGO_WRITER_DATABASE_URL/);
    expect(workflow).toMatch(/FAREJO_LOGO_S3_ACCESS_KEY_ID/);
    expect(workflow).toMatch(/FAREJO_LOGO_S3_SECRET_ACCESS_KEY/);
  });

  it("supplies the Supabase CA so both pg roles verify the server identity (ADR-0055)", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/FAREJO_SUPABASE_CA_CERT/);
  });

  it("runs after a successful scrape and offers a manual recovery trigger", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/workflows:\s*\[Scrape cashback\]/);
    expect(workflow).toMatch(/workflow_dispatch:/);
  });

  it("measures the 95% coverage target with its own credential, always after ingestion (F3/T16, #62, ADR-0054)", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(/FAREJO_LOGO_COVERAGE_DATABASE_URL/);
    expect(workflow).toMatch(/logos:coverage/);
    expect(workflow).toMatch(
      /if:\s*always\(\)\s*\n\s*continue-on-error:\s*true\s*\n\s*run:\s*pnpm --filter @farejo\/scraper logos:coverage/,
    );

    const ingestIndex = workflow.indexOf("logos:ingest");
    const coverageIndex = workflow.indexOf("logos:coverage");
    expect(ingestIndex).toBeGreaterThan(-1);
    expect(coverageIndex).toBeGreaterThan(ingestIndex);
  });
});
