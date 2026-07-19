import { describe, expect, it } from "vitest";
import {
  EXPECTED_COLUMN_GRANTS,
  EXPECTED_FUNCTION_GRANTS,
  EXPECTED_FUNCTIONS,
  EXPECTED_LOGIN_ROLES,
  EXPECTED_RLS_TABLES,
  EXPECTED_TABLE_GRANTS,
  EXPECTED_WEB_READ_VIEWS,
  formatSchemaVerificationReport,
  LOGO_BUCKET_ID,
  verifyProductionSchema,
  type SchemaCheckPool,
} from "./verify-production-schema.mjs";

// node-postgres devolve `bigint` como string por padrão — o fixture usa a forma real que a
// query devolveria, não o number que seria mais fácil de escrever à mão.
const FULL_BUCKET_ROW = { public: true, file_size_limit: "2097152", allowed_mime_types: ["image/webp"] };

function fakePool(overrides: {
  roles?: string[];
  views?: string[];
  functions?: { schema: string; name: string }[];
  rls?: { relname: string; relrowsecurity: boolean }[];
  bucket?: { public: boolean; file_size_limit: string | number | null; allowed_mime_types: string[] | null } | null;
  tableGrants?: (typeof EXPECTED_TABLE_GRANTS[number] & { granted: boolean })[];
  functionGrants?: (typeof EXPECTED_FUNCTION_GRANTS[number] & { granted: boolean })[];
  columnGrants?: (typeof EXPECTED_COLUMN_GRANTS[number] & { granted: boolean })[];
} = {}): SchemaCheckPool {
  const responses = [
    overrides.roles ?? [...EXPECTED_LOGIN_ROLES],
    overrides.views ?? [...EXPECTED_WEB_READ_VIEWS],
    overrides.functions ?? [...EXPECTED_FUNCTIONS],
    overrides.rls ?? EXPECTED_RLS_TABLES.map((relname) => ({ relname, relrowsecurity: true })),
    overrides.bucket === undefined ? [FULL_BUCKET_ROW] : overrides.bucket === null ? [] : [overrides.bucket],
    overrides.tableGrants ?? EXPECTED_TABLE_GRANTS.map((g) => ({ ...g, granted: true })),
    overrides.functionGrants ?? EXPECTED_FUNCTION_GRANTS.map((g) => ({ ...g, granted: true })),
    overrides.columnGrants ?? EXPECTED_COLUMN_GRANTS.map((g) => ({ ...g, granted: true })),
  ];
  let call = 0;
  return {
    async query<T = unknown>() {
      const rows = responses[call] ?? [];
      call += 1;
      return { rows: rows.map((value) => (typeof value === "string" ? { rolname: value, table_name: value } : value)) as T[] };
    },
  };
}

describe("verifyProductionSchema", () => {
  it("reports ok when every role, view, function, RLS table and the logo bucket match the merged migrations", async () => {
    const report = await verifyProductionSchema(fakePool());
    expect(report.ok).toBe(true);
    expect(report.missingRoles).toEqual([]);
    expect(report.missingViews).toEqual([]);
    expect(report.missingFunctions).toEqual([]);
    expect(report.missingRlsTables).toEqual([]);
    expect(report.tablesWithoutRls).toEqual([]);
    expect(report.storageBucketOk).toBe(true);
    expect(report.missingTableGrants).toEqual([]);
    expect(report.missingFunctionGrants).toEqual([]);
    expect(report.missingColumnGrants).toEqual([]);
  });

  it("flags a missing role without failing the other checks", async () => {
    const report = await verifyProductionSchema(fakePool({ roles: EXPECTED_LOGIN_ROLES.filter((role) => role !== "farejo_logo_writer") }));
    expect(report.ok).toBe(false);
    expect(report.missingRoles).toEqual(["farejo_logo_writer"]);
  });

  it("flags a missing web_read view", async () => {
    const report = await verifyProductionSchema(fakePool({ views: EXPECTED_WEB_READ_VIEWS.filter((view) => view !== "logo_coverage") }));
    expect(report.ok).toBe(false);
    expect(report.missingViews).toEqual(["logo_coverage"]);
  });

  it("flags a missing function, keyed by schema.name", async () => {
    const report = await verifyProductionSchema(fakePool({ functions: EXPECTED_FUNCTIONS.filter((fn) => fn.name !== "verify_alias_merge") }));
    expect(report.ok).toBe(false);
    expect(report.missingFunctions).toEqual(["curation.verify_alias_merge"]);
  });

  it("flags a table that exists but never had RLS enabled, distinct from a table that's entirely missing", async () => {
    const rls = EXPECTED_RLS_TABLES.map((relname) => ({ relname, relrowsecurity: relname !== "offer_history" }))
      .filter((row) => row.relname !== "crawl_state");
    const report = await verifyProductionSchema(fakePool({ rls }));
    expect(report.ok).toBe(false);
    expect(report.tablesWithoutRls).toEqual(["offer_history"]);
    expect(report.missingRlsTables).toEqual(["crawl_state"]);
  });

  it("flags a missing storage bucket distinctly from a misconfigured one", async () => {
    const missing = await verifyProductionSchema(fakePool({ bucket: null }));
    expect(missing.ok).toBe(false);
    expect(missing.storageBucketMissing).toBe(true);
    expect(missing.storageBucketOk).toBe(false);

    const misconfigured = await verifyProductionSchema(fakePool({ bucket: { public: false, file_size_limit: 2097152, allowed_mime_types: ["image/webp"] } }));
    expect(misconfigured.ok).toBe(false);
    expect(misconfigured.storageBucketMissing).toBe(false);
    expect(misconfigured.storageBucketOk).toBe(false);
  });

  it("accepts file_size_limit as the string node-postgres returns for bigint columns, not just a number", async () => {
    const report = await verifyProductionSchema(fakePool({ bucket: { public: true, file_size_limit: "2097152", allowed_mime_types: ["image/webp"] } }));
    expect(report.storageBucketOk).toBe(true);
  });

  it(`checks the bucket id "${LOGO_BUCKET_ID}"`, () => {
    expect(LOGO_BUCKET_ID).toBe("store-logos");
  });

  it("flags a role that exists but lost a table/view grant it needs (e.g. farejo_web losing SELECT on a catalog view)", async () => {
    const tableGrants = EXPECTED_TABLE_GRANTS.map((g) => ({
      ...g,
      granted: !(g.role === "farejo_web" && g.relation === "web_read.store_redirects"),
    }));
    const report = await verifyProductionSchema(fakePool({ tableGrants }));
    expect(report.ok).toBe(false);
    expect(report.missingTableGrants).toEqual(["farejo_web→web_read.store_redirects(SELECT)"]);
  });

  it("flags a role that lost EXECUTE on a function it needs", async () => {
    const functionGrants = EXPECTED_FUNCTION_GRANTS.map((g) => ({
      ...g,
      granted: !(g.role === "farejo_curation" && g.signature.includes("verify_alias_merge")),
    }));
    const report = await verifyProductionSchema(fakePool({ functionGrants }));
    expect(report.ok).toBe(false);
    expect(report.missingFunctionGrants).toEqual(["farejo_curation→curation.verify_alias_merge(text, jsonb)"]);
  });

  it("flags a role that lost the column-scoped grant it needs, distinct from losing the whole table", async () => {
    const columnGrants = EXPECTED_COLUMN_GRANTS.map((g) => ({ ...g, granted: g.column !== "logo_hash" }));
    const report = await verifyProductionSchema(fakePool({ columnGrants }));
    expect(report.ok).toBe(false);
    expect(report.missingColumnGrants).toEqual(["farejo_logo_writer→public.stores.logo_hash(UPDATE)"]);
  });
});

describe("formatSchemaVerificationReport", () => {
  it("marks a passing report with a check mark and no bullet points", async () => {
    const report = await verifyProductionSchema(fakePool());
    const text = formatSchemaVerificationReport(report);
    expect(text).toContain("✅");
    expect(text).not.toContain("  -");
  });

  it("lists every category of drift for a failing report", async () => {
    const report = await verifyProductionSchema(
      fakePool({
        roles: [],
        views: [],
        functions: [],
        rls: [],
        bucket: null,
        tableGrants: EXPECTED_TABLE_GRANTS.map((g) => ({ ...g, granted: false })),
        functionGrants: EXPECTED_FUNCTION_GRANTS.map((g) => ({ ...g, granted: false })),
        columnGrants: EXPECTED_COLUMN_GRANTS.map((g) => ({ ...g, granted: false })),
      }),
    );
    const text = formatSchemaVerificationReport(report);
    expect(text).toContain("❌");
    expect(text).toContain("roles ausentes");
    expect(text).toContain("views ausentes");
    expect(text).toContain("funções ausentes");
    expect(text).toContain("tabelas ausentes");
    expect(text).toContain(`bucket "${LOGO_BUCKET_ID}" não existe`);
    expect(text).toContain("grants de tabela/view ausentes");
    expect(text).toContain("grants de execução ausentes");
    expect(text).toContain("grants de coluna ausentes");
  });
});
