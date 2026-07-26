import { describe, expect, it } from "vitest";
import {
  ALLOWED_COLUMN_GRANTS,
  ALLOWED_FUNCTION_GRANTS,
  ALLOWED_SCHEMA_GRANTS,
  ALLOWED_TABLE_GRANTS,
  formatPrivilegeVerificationReport,
  verifyProductionPrivileges,
  type PrivilegeCheckPool,
} from "./verify-privileges.js";

// Reconstrói as rows "limpas" a partir das allowlists exportadas — assim o estado ok dos testes
// acompanha a allowlist real: mudou o contrato, mudou o fixture, sem edição manual.
function tableRowsFromAllowlist() {
  return [...ALLOWED_TABLE_GRANTS].map((key) => {
    const [grantee, object, privilege] = key.split("|");
    const dot = object!.indexOf(".");
    return { grantee, schema: object!.slice(0, dot), object: object!.slice(dot + 1), privilege };
  });
}
function functionRowsFromAllowlist() {
  return [...ALLOWED_FUNCTION_GRANTS].map((key) => {
    const [grantee, object, privilege] = key.split("|");
    const dot = object!.indexOf(".");
    return { grantee, schema: object!.slice(0, dot), object: object!.slice(dot + 1), privilege };
  });
}
function columnRowsFromAllowlist() {
  return [...ALLOWED_COLUMN_GRANTS].map((key) => {
    const [grantee, object, privilege] = key.split("|");
    const [schema, obj, column] = object!.split(".");
    return { grantee, schema, object: obj, column, privilege };
  });
}
function schemaRowsFromAllowlist() {
  return [...ALLOWED_SCHEMA_GRANTS].map((key) => {
    const [grantee, schema, privilege] = key.split("|");
    return { grantee, schema, privilege };
  });
}
// Estado real limpo das 6 roles auditadas: anon/authenticated NOLOGIN+INHERIT (default plataforma,
// não auditado); as do farejô LOGIN+noinherit.
function cleanRoleRows() {
  const base = { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false };
  return [
    { rolname: "anon", rolinherit: true, rolcanlogin: false, ...base },
    { rolname: "authenticated", rolinherit: true, rolcanlogin: false, ...base },
    { rolname: "farejo_web", rolinherit: false, rolcanlogin: true, ...base },
    { rolname: "farejo_logo_writer", rolinherit: false, rolcanlogin: true, ...base },
    { rolname: "farejo_bot", rolinherit: false, rolcanlogin: true, ...base },
    { rolname: "farejo_notifier", rolinherit: false, rolcanlogin: true, ...base },
  ];
}
const CLEAN_POLICY_ROWS = [
  { schemaname: "storage", tablename: "objects", policyname: "store_logos_select_objects", cmd: "SELECT", roles: "{public}" },
];

function fakePool(overrides: {
  table?: unknown[];
  column?: unknown[];
  function?: unknown[];
  schema?: unknown[];
  role?: unknown[];
  membership?: unknown[];
  policy?: unknown[];
} = {}): PrivilegeCheckPool {
  const responses = [
    overrides.table ?? tableRowsFromAllowlist(),
    overrides.column ?? columnRowsFromAllowlist(),
    overrides.function ?? functionRowsFromAllowlist(),
    overrides.schema ?? schemaRowsFromAllowlist(),
    overrides.role ?? cleanRoleRows(),
    overrides.membership ?? [],
    overrides.policy ?? CLEAN_POLICY_ROWS,
  ];
  let call = 0;
  return {
    async query<T = unknown>() {
      const rows = (responses[call] ?? []) as T[];
      call += 1;
      return { rows };
    },
  };
}

describe("verifyProductionPrivileges", () => {
  it("reports ok when every audited grantee holds exactly the contract and nothing more", async () => {
    const report = await verifyProductionPrivileges(fakePool());
    expect(report.ok).toBe(true);
    expect(report).toMatchObject({
      unexpectedTableGrants: [],
      unexpectedColumnGrants: [],
      unexpectedFunctionGrants: [],
      unexpectedSchemaGrants: [],
      unexpectedMemberships: [],
      unexpectedRoleAttributes: [],
      unexpectedPolicies: [],
    });
  });

  it("flags a table SELECT granted to anon (the classic data-leak vector)", async () => {
    const table = [...tableRowsFromAllowlist(), { grantee: "anon", schema: "public", object: "offers", privilege: "SELECT" }];
    const report = await verifyProductionPrivileges(fakePool({ table }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedTableGrants).toEqual(["anon|public.offers|SELECT"]);
  });

  it("flags EXECUTE on a function granted to authenticated", async () => {
    const fn = [...functionRowsFromAllowlist(), { grantee: "authenticated", schema: "web_read", object: "catalog_search", privilege: "EXECUTE" }];
    const report = await verifyProductionPrivileges(fakePool({ function: fn }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedFunctionGrants).toEqual(["authenticated|web_read.catalog_search|EXECUTE"]);
  });

  it("flags a column UPDATE outside the two logo pointer columns", async () => {
    const column = [...columnRowsFromAllowlist(), { grantee: "farejo_logo_writer", schema: "public", object: "stores", column: "name", privilege: "UPDATE" }];
    const report = await verifyProductionPrivileges(fakePool({ column }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedColumnGrants).toEqual(["farejo_logo_writer|public.stores.name|UPDATE"]);
  });

  it("flags USAGE on public re-granted to anon (survives the revoke-from-public)", async () => {
    const schema = [...schemaRowsFromAllowlist(), { grantee: "anon", schema: "public", privilege: "USAGE" }];
    const report = await verifyProductionPrivileges(fakePool({ schema }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedSchemaGrants).toEqual(["anon|public|USAGE"]);
  });

  it("flags farejo_web becoming a member of service_role (privilege escalation)", async () => {
    const report = await verifyProductionPrivileges(fakePool({ membership: [{ member: "farejo_web", role_of: "service_role" }] }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedMemberships).toEqual(["farejo_web→service_role"]);
  });

  it("flags superuser/bypassrls/createrole and a login-flag mismatch on the role", async () => {
    const role = cleanRoleRows().map((r) =>
      r.rolname === "farejo_logo_writer" ? { ...r, rolbypassrls: true } : r.rolname === "anon" ? { ...r, rolcanlogin: true } : r,
    );
    const report = await verifyProductionPrivileges(fakePool({ role }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedRoleAttributes).toEqual(["anon:LOGIN", "farejo_logo_writer:BYPASSRLS"]);
  });

  it("does NOT flag anon/authenticated INHERIT (platform default), but DOES flag INHERIT on a farejo role", async () => {
    const clean = await verifyProductionPrivileges(fakePool());
    expect(clean.unexpectedRoleAttributes).toEqual([]);

    const role = cleanRoleRows().map((r) => (r.rolname === "farejo_web" ? { ...r, rolinherit: true } : r));
    const report = await verifyProductionPrivileges(fakePool({ role }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedRoleAttributes).toEqual(["farejo_web:INHERIT"]);
  });

  it("flags a new permissive policy on a product table, keeping the intended logo policy", async () => {
    const policy = [...CLEAN_POLICY_ROWS, { schemaname: "public", tablename: "offers", policyname: "evil", cmd: "SELECT", roles: "{anon}" }];
    const report = await verifyProductionPrivileges(fakePool({ policy }));
    expect(report.ok).toBe(false);
    expect(report.unexpectedPolicies).toEqual(["public.offers|evil|SELECT"]);
  });

  it("treats the intended storage logo policy as allowed, not excess", async () => {
    const report = await verifyProductionPrivileges(fakePool());
    expect(report.unexpectedPolicies).toEqual([]);
  });
});

describe("formatPrivilegeVerificationReport", () => {
  it("marks a passing report with a check mark and no bullets", async () => {
    const report = await verifyProductionPrivileges(fakePool());
    const text = formatPrivilegeVerificationReport(report);
    expect(text).toContain("✅");
    expect(text).not.toContain("  -");
  });

  it("lists every category of excess for a failing report", async () => {
    const report = await verifyProductionPrivileges(
      fakePool({
        table: [{ grantee: "anon", schema: "public", object: "offers", privilege: "SELECT" }],
        function: [{ grantee: "anon", schema: "web_read", object: "catalog_search", privilege: "EXECUTE" }],
        column: [{ grantee: "anon", schema: "public", object: "stores", column: "name", privilege: "UPDATE" }],
        schema: [{ grantee: "anon", schema: "public", privilege: "USAGE" }],
        membership: [{ member: "farejo_web", role_of: "service_role" }],
        role: cleanRoleRows().map((r) => (r.rolname === "farejo_web" ? { ...r, rolsuper: true } : r)),
        policy: [{ schemaname: "public", tablename: "offers", policyname: "evil", cmd: "ALL", roles: "{anon}" }],
      }),
    );
    const text = formatPrivilegeVerificationReport(report);
    expect(text).toContain("❌");
    expect(text).toContain("grants de tabela/view");
    expect(text).toContain("grants de execução");
    expect(text).toContain("grants de coluna");
    expect(text).toContain("grants de schema");
    expect(text).toContain("memberships");
    expect(text).toContain("atributos de role");
    expect(text).toContain("policies permissivas");
  });
});
