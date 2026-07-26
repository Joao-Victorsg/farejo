import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyProductionPrivileges } from "./verify-privileges.js";

/**
 * F4/#113 (ADR-0063/ADR-0064/ADR-0066): fronteira de banco dos Avisos, exercitada sob as roles
 * REAIS (`set role`), nunca como `service_role`. É o mesmo padrão do teste do ingestor de logos:
 * o valor está em provar os GRANTs junto com o schema, porque a promessa central desta feature —
 * "a superfície pública não enxerga o histórico de ofertas" — é um privilégio, não uma linha de
 * código.
 *
 * Vive em `packages/db-audit` porque o contrato auditado é o do banco na raiz do monorepo
 * (ADR-0061), não o de um app.
 */
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue113avisos";
const client = new Client({ connectionString: databaseUrl });

let storeId: number;
let otherStoreId: number;
let subscriberId: number;

async function asRole<T>(role: string, run: () => Promise<T>): Promise<T> {
  await client.query(`set role ${role}`);
  try {
    return await run();
  } finally {
    await client.query("reset role");
  }
}

async function cleanFixtures() {
  await client.query("delete from public.subscribers where telegram_chat_id between 911300 and 911399");
  await client.query("delete from public.offer_history where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();

  const stores = await client.query<{ id: number }>(
    "insert into public.stores (slug, name) values ($1, $2), ($3, $4) returning id",
    [`${fixturePrefix}loja`, "Issue 113 Loja", `${fixturePrefix}outra`, "Issue 113 Outra"],
  );
  storeId = stores.rows[0]!.id;
  otherStoreId = stores.rows[1]!.id;

  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at)
     values ($1, 'inter', 'percent', 5, '5%', 'https://shopping.inter.co/site-parceiro/lojas/issue113', true, now())`,
    [storeId],
  );
  await client.query(
    `insert into public.offer_history (store_id, platform_id, reward_type, value, changed_at)
     values ($1, 'inter', 'percent', 5, now())`,
    [storeId],
  );

  const subscriber = await client.query<{ id: number }>(
    "insert into public.subscribers (telegram_chat_id) values (911301) returning id",
  );
  subscriberId = subscriber.rows[0]!.id;
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("schema dos Avisos", () => {
  it("guarda do Assinante só o chat, o cursor e a data — nunca nome, @ ou idioma (ADR-0066)", async () => {
    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'subscribers' order by column_name",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "created_at",
      "id",
      "last_notified_history_id",
      "telegram_chat_id",
    ]);
  });

  it("exige Piso no Modo acompanhamento e o proíbe no Modo melhoria", async () => {
    await expect(
      client.query("insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'tracking')", [subscriberId, storeId]),
    ).rejects.toThrow(/subscriptions_floor_matches_mode/);

    await expect(
      client.query(
        "insert into public.subscriptions (subscriber_id, store_id, mode, floor_value, floor_reward_type) values ($1, $2, 'improvement', 10, 'percent')",
        [subscriberId, storeId],
      ),
    ).rejects.toThrow(/subscriptions_floor_matches_mode/);
  });

  it("aceita só as grandezas de Reward que o domínio conhece", async () => {
    await expect(
      client.query(
        "insert into public.subscriptions (subscriber_id, store_id, mode, floor_value, floor_reward_type) values ($1, $2, 'tracking', 10, 'reais')",
        [subscriberId, storeId],
      ),
    ).rejects.toThrow(/floor_reward_type/);
  });

  // ADR-0063: cascade apagaria a Inscrição em silêncio quando um merge de alias absorvesse a loja,
  // e a pessoa nunca saberia que parou de ser avisada. O merge tem de tratá-la explicitamente (#115).
  it("recusa apagar uma Loja canônica que ainda tem Inscrição, em vez de cascatear", async () => {
    await client.query(
      "insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')",
      [subscriberId, otherStoreId],
    );
    await expect(client.query("delete from public.stores where id = $1", [otherStoreId])).rejects.toThrow(/foreign key|violates/i);
    await client.query("delete from public.subscriptions where subscriber_id = $1 and store_id = $2", [subscriberId, otherStoreId]);
  });

  // /parar apaga de verdade (ADR-0066), e apagar o Assinante leva as Inscrições junto.
  it("apaga as Inscrições junto com o Assinante", async () => {
    const temporary = await client.query<{ id: number }>("insert into public.subscribers (telegram_chat_id) values (911302) returning id");
    const temporaryId = temporary.rows[0]!.id;
    await client.query("insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')", [temporaryId, storeId]);

    await client.query("delete from public.subscribers where id = $1", [temporaryId]);
    const left = await client.query("select 1 from public.subscriptions where subscriber_id = $1", [temporaryId]);
    expect(left.rowCount).toBe(0);
  });
});

describe("farejo_bot — entrada pública", () => {
  it("cria, ajusta e remove Inscrições", async () => {
    await asRole("farejo_bot", async () => {
      await client.query("insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')", [subscriberId, storeId]);
      await client.query(
        "update public.subscriptions set mode = 'tracking', floor_value = 10, floor_reward_type = 'percent' where subscriber_id = $1 and store_id = $2",
        [subscriberId, storeId],
      );
      const rows = await client.query("select mode from public.subscriptions where subscriber_id = $1 and store_id = $2", [subscriberId, storeId]);
      expect(rows.rows).toEqual([{ mode: "tracking" }]);
      await client.query("delete from public.subscriptions where subscriber_id = $1 and store_id = $2", [subscriberId, storeId]);
    });
  });

  it("cria e apaga o Assinante, mas não mexe no cursor de entrega", async () => {
    await asRole("farejo_bot", async () => {
      await client.query("insert into public.subscribers (telegram_chat_id) values (911303)");
      await expect(client.query("update public.subscribers set last_notified_history_id = 99 where telegram_chat_id = 911303")).rejects.toThrow(/permission denied/i);
      await client.query("delete from public.subscribers where telegram_chat_id = 911303");
    });
  });

  it("resolve a loja pelo slug e pelos redirects, e vê as ofertas correntes pelo catálogo público", async () => {
    await asRole("farejo_bot", async () => {
      await expect(client.query("select id from public.stores where slug = $1", [`${fixturePrefix}loja`])).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query("select from_slug, to_slug from web_read.store_redirects")).resolves.toBeDefined();
      await expect(client.query("select store_slug, value from web_read.catalog_offers where store_slug = $1", [`${fixturePrefix}loja`])).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  // A promessa central da ADR-0064, como asserção executável: a superfície exposta na internet
  // nunca enxerga o histórico de ofertas.
  it("NÃO enxerga o histórico de ofertas", async () => {
    await asRole("farejo_bot", async () => {
      await expect(client.query("select * from public.offer_history")).rejects.toThrow(/permission denied/i);
    });
  });

  it("NÃO enxerga ofertas cruas, curadoria, logos nem ativações", async () => {
    await asRole("farejo_bot", async () => {
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.store_aliases")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.store_logo_sources")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.activation_metrics")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.crawl_state")).rejects.toThrow(/permission denied/i);
    });
  });
});

describe("farejo_notifier — job pós-scrape", () => {
  it("lê Inscrições, ofertas e histórico para montar o Aviso", async () => {
    await asRole("farejo_notifier", async () => {
      await expect(client.query("select * from public.subscribers")).resolves.toBeDefined();
      await expect(client.query("select * from public.subscriptions")).resolves.toBeDefined();
      await expect(client.query("select * from public.offer_history where store_id = $1", [storeId])).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query("select * from public.offers where store_id = $1", [storeId])).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query("select name from public.stores where id = $1", [storeId])).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query("select name from public.platforms where id = 'inter'")).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  it("só escreve o cursor, e nunca o resto do Assinante", async () => {
    await asRole("farejo_notifier", async () => {
      await client.query("update public.subscribers set last_notified_history_id = 42 where id = $1", [subscriberId]);
      await expect(client.query("update public.subscribers set telegram_chat_id = 911399 where id = $1", [subscriberId])).rejects.toThrow(/permission denied/i);
    });
    const cursor = await client.query<{ last_notified_history_id: string }>("select last_notified_history_id from public.subscribers where id = $1", [subscriberId]);
    expect(cursor.rows[0]!.last_notified_history_id).toBe("42");
  });

  it("apaga o Assinante que revogou, levando as Inscrições junto, mas nunca cria uma", async () => {
    await client.query("insert into public.subscribers (telegram_chat_id) values (911304)");
    await client.query(
      "insert into public.subscriptions (subscriber_id, store_id, mode) select id, $1, 'improvement' from public.subscribers where telegram_chat_id = 911304",
      [storeId],
    );

    await asRole("farejo_notifier", async () => {
      await expect(
        client.query("insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')", [subscriberId, storeId]),
      ).rejects.toThrow(/permission denied/i);
      await client.query("delete from public.subscribers where telegram_chat_id = 911304");
    });

    const left = await client.query("select 1 from public.subscribers where telegram_chat_id = 911304");
    expect(left.rowCount).toBe(0);
  });

  it("NÃO enxerga curadoria, logos nem ativações", async () => {
    await asRole("farejo_notifier", async () => {
      await expect(client.query("select * from public.store_aliases")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.store_logo_sources")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.activation_metrics")).rejects.toThrow(/permission denied/i);
    });
  });
});

// A verificação negativa da ADR-0062 só vale se ela REPROVAR de fato. Testar contra o banco real —
// e não com pool falso, como os testes de unidade do verificador — é o que prova que o vetor
// concreto desta feature (dar histórico de ofertas à superfície pública) para a publicação.
describe("verificação negativa contra o banco real", () => {
  it("aprova o estado limpo das roles novas", async () => {
    const report = await verifyProductionPrivileges(client);
    expect(report).toMatchObject({ ok: true, unexpectedTableGrants: [], unexpectedColumnGrants: [] });
  });

  it("reprova quando farejo_bot ganha o histórico de ofertas", async () => {
    await client.query("grant select on public.offer_history to farejo_bot");
    try {
      const report = await verifyProductionPrivileges(client);
      expect(report.ok).toBe(false);
      expect(report.unexpectedTableGrants).toContain("farejo_bot|public.offer_history|SELECT");
    } finally {
      await client.query("revoke select on public.offer_history from farejo_bot");
    }
    await expect(verifyProductionPrivileges(client)).resolves.toMatchObject({ ok: true });
  });

  it("reprova quando o job de Avisos ganha escrita além do cursor", async () => {
    await client.query("grant update on public.subscribers to farejo_notifier");
    try {
      const report = await verifyProductionPrivileges(client);
      expect(report.ok).toBe(false);
      expect(report.unexpectedTableGrants).toContain("farejo_notifier|public.subscribers|UPDATE");
    } finally {
      await client.query("revoke update on public.subscribers from farejo_notifier");
      // O revoke da tabela leva junto o grant por coluna; recompõe o contrato da migration.
      await client.query("grant update (last_notified_history_id) on public.subscribers to farejo_notifier");
    }
    await expect(verifyProductionPrivileges(client)).resolves.toMatchObject({ ok: true });
  });

  it("reprova quando farejo_bot vira membro de outra role (escalação por herança)", async () => {
    await client.query("grant farejo_notifier to farejo_bot");
    try {
      const report = await verifyProductionPrivileges(client);
      expect(report.ok).toBe(false);
      expect(report.unexpectedMemberships).toContain("farejo_bot→farejo_notifier");
    } finally {
      await client.query("revoke farejo_notifier from farejo_bot");
    }
  });
});

describe("anon e authenticated", () => {
  it("continuam sem alcançar as tabelas novas (ADR-0062)", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        await expect(client.query("select * from public.subscribers")).rejects.toThrow(/permission denied/i);
        await expect(client.query("select * from public.subscriptions")).rejects.toThrow(/permission denied/i);
      });
    }
  });
});
