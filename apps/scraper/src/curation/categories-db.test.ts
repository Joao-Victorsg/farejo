import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
beforeAll(() => client.connect());
afterAll(() => client.end());

it("aplica revisão de categorias, verifica resultado e rejeita propostas pendentes", async () => {
  await client.query("begin");
  try {
    await client.query("insert into public.stores (slug, name) values ('category-curation-test', 'Curadoria teste')");
    const manifest = { version: 1, status: "approved", categories: [{ slug: "category-curation", name: "Moda", icon: "shirt", position: 1, active: true }], stores: [{ slug: "category-curation-test", categories: [{ slug: "category-curation", evidence: [{ url: "https://example.test/moda", observedAt: "2026-09-10", note: "Departamento oficial de moda" }] }] }] };
    await client.query("set local role farejo_curation");
    const first = await client.query("select * from curation.apply_category_manifest($1)", [manifest]);
    expect(first.rows[0]).toMatchObject({ applied: true });
    expect((await client.query("select curation.verify_category_manifest($1) as valid", [manifest])).rows).toEqual([{ valid: true }]);
    expect((await client.query("select * from curation.apply_category_manifest($1)", [manifest])).rows[0]).toMatchObject({ applied: false });
    await client.query("savepoint invalid_manifest");
    await expect(client.query("select * from curation.apply_category_manifest($1)", [{ ...manifest, status: "pending" }])).rejects.toThrow(/approved/);
    await client.query("rollback to savepoint invalid_manifest");
    expect((await client.query("select curation.verify_category_manifest($1) as valid", [manifest])).rows).toEqual([{ valid: true }]);
  } finally {
    await client.query("rollback");
  }
});
