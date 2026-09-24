import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe("catálogo por categoria", () => {
  it("preserva as categorias e evidências quando duas lojas são unificadas", async () => {
    await client.query("begin");
    try {
      await client.query("insert into public.categories (slug, name, icon, position) values ('test-merge', 'Merge teste', 'shirt', 1)");
      await client.query("insert into public.stores (slug, name) values ('category-merge-a', 'Canônica'), ('category-merge-b', 'Absorvida')");
      await client.query("insert into public.store_aliases (platform_id, raw_name, store_id) select 'inter', 'Categoria merge teste', id from public.stores where slug = 'category-merge-b'");
      await client.query("insert into public.store_categories (store_id, category_slug, evidence) select id, 'test-merge', jsonb_build_array(jsonb_build_object('url', 'https://example.test/' || slug)) from public.stores where slug in ('category-merge-a', 'category-merge-b')");
      await client.query("set local role farejo_curation");
      expect((await client.query("select * from curation.apply_alias_merge('category-merge-a', '[{\"platformId\":\"inter\",\"rawName\":\"Categoria merge teste\"}]')")).rows[0]).toMatchObject({ applied: true, reason: "merged" });
      await client.query("reset role");
      expect((await client.query("select s.slug, jsonb_array_length(sc.evidence) as sources from public.store_categories sc join public.stores s on s.id = sc.store_id where sc.category_slug = 'test-merge'")).rows).toEqual([{ slug: "category-merge-a", sources: 2 }]);
    } finally {
      await client.query("rollback");
    }
  });
  it("filtra antes de paginar e mantém lojas multicategoria sem duplicação", async () => {
    await client.query("begin");
    try {
      await client.query("insert into public.categories (slug, name, icon, position) values ('test-moda', 'Moda teste', 'shirt', 1), ('test-casa', 'Casa teste', 'house', 2)");
      for (let index = 0; index < 27; index += 1) {
        const { rows: [store] } = await client.query<{ id: string }>(
          "insert into public.stores (slug, name) values ($1, $2) returning id",
          [`category-test-${index}`, `Categoria teste ${String(index).padStart(2, "0")}`],
        );
        if (!store) throw new Error("Fixture missing");
        await client.query("insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 2, '2%', 'https://example.test/store', true, now())", [store.id]);
        await client.query("insert into public.store_categories (store_id, category_slug, evidence) values ($1, 'test-moda', $2)", [store.id, JSON.stringify([{ url: "https://example.test/moda", observedAt: "2026-09-10", note: "Fixture" }])]);
        if (index === 0) await client.query("insert into public.store_categories (store_id, category_slug, evidence) values ($1, 'test-casa', $2)", [store.id, JSON.stringify([{ url: "https://example.test/casa", observedAt: "2026-09-10", note: "Fixture" }])]);
      }
      await client.query("set local role farejo_web");
      const first = await client.query("select * from web_read.catalog_search('', 'az', 1, 'test-moda')");
      const second = await client.query("select * from web_read.catalog_search('', 'az', 2, 'test-moda')");
      expect(first.rows).toHaveLength(24);
      expect(second.rows).toHaveLength(3);
      expect(second.rows[0]).toMatchObject({ slug: "category-test-24", total_count: 27 });
      expect((await client.query("select * from web_read.catalog_search('', 'az', 1, 'test-casa')")).rows).toMatchObject([{ slug: "category-test-0", total_count: 1 }]);
      expect((await client.query("select * from web_read.catalog_search('inexistente', 'az', 1, 'test-moda')")).rows).toEqual([]);
    } finally {
      await client.query("rollback");
    }
  });
});
