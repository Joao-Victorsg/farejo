import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBotHandler } from "./handler.js";

/**
 * F4/#116 (ADR-0064/ADR-0065/ADR-0066) — seam do `apps/bot`: o handler HTTP exercitado com
 * objetos `Request` reais, contra o Postgres local, sob a role REAL `farejo_bot`.
 *
 * A role importa tanto quanto a lógica: metade do contrato desta feature é o que a superfície
 * pública NÃO alcança, e isso só é verdade se o teste usar a credencial de verdade.
 */
const adminUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const botUrl = `${adminUrl}?options=-c%20role%3Dfarejo_bot`;
const fixturePrefix = "issue116bot";
const CHAT = 911800;

const admin = new Client({ connectionString: adminUrl });
const bot = new Client({ connectionString: botUrl });

const SECRET = "segredo-de-teste-do-webhook";
const PATH = "tg-a91f4c2e";
const SITE = "https://farejo.test";

const handler = () =>
  createBotHandler({ pool: bot, secretToken: SECRET, webhookPath: PATH, siteUrl: SITE });

/** Pool que explode se alguém encostar nele — prova que um caminho não toca o banco. */
const forbiddenPool = {
  query: () => {
    throw new Error("o handler não deveria ter consultado o banco");
  },
};

function update(text: string, chatId = CHAT, extra: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 7,
      date: 1785000000,
      chat: { id: chatId, type: "private", first_name: "Fulano", last_name: "de Tal", username: "fulano" },
      from: { id: chatId, is_bot: false, first_name: "Fulano", username: "fulano", language_code: "pt-br" },
      text,
      ...extra,
    },
  };
}

function request(body: unknown, { secret = SECRET, path = PATH }: { secret?: string | null; path?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-telegram-bot-api-secret-token", secret);
  return new Request(`https://bot.farejo.test/api/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function replyOf(response: Response): Promise<{ method?: string; chat_id?: number; text?: string }> {
  return (await response.json()) as { method?: string; chat_id?: number; text?: string };
}

async function subscriptionsOfChat(chatId = CHAT) {
  const result = await admin.query<{ slug: string; mode: string; floor_value: string | null }>(
    `select st.slug, s.mode, s.floor_value
     from public.subscriptions s
     join public.subscribers sub on sub.id = s.subscriber_id
     join public.stores st on st.id = s.store_id
     where sub.telegram_chat_id = $1
     order by st.slug`,
    [chatId],
  );
  return result.rows;
}

async function cleanFixtures() {
  await admin.query("delete from public.subscribers where telegram_chat_id between $1 and $2", [CHAT, CHAT + 99]);
  await admin.query("delete from public.store_slug_redirects where from_slug like $1", [`${fixturePrefix}%`]);
  await admin.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await admin.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

// F4/#117 — faixa de fixtures própria (chat 917100–917199, prefixo "issue117bot"), separada da
// de #116 (911800) e da de #118 (918100), que rodam em worktrees irmãs contra o MESMO Postgres.
const pisoPrefix = "issue117bot";
const PISO_CHAT = 917100;

async function insertPisoStore(suffix: string, name: string): Promise<{ id: number; slug: string }> {
  const slug = `${pisoPrefix}${suffix}`;
  const result = await admin.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  return { id: result.rows[0]!.id, slug };
}

/** Oferta pública elegível por padrão (`active=true`, `last_seen_at` recente) — `hoursOld` empurra pra fora do frescor de 48h quando o teste precisa de uma oferta NÃO elegível. */
async function insertPisoOffer(
  storeId: number,
  platformId: string,
  rewardType: "percent" | "fixed",
  value: number,
  options: { active?: boolean; hoursOld?: number } = {},
) {
  await admin.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, is_upto, raw_text, url, active, last_seen_at)
     values ($1, $2, $3, $4, false, $5, $6, $7, now() - ($8::text || ' hours')::interval)`,
    [storeId, platformId, rewardType, value, `${value}`, `https://example.test/${platformId}`, options.active ?? true, String(options.hoursOld ?? 0)],
  );
}

async function insertPisoSubscriber(chatId: number): Promise<number> {
  const result = await admin.query<{ id: number }>("insert into public.subscribers (telegram_chat_id) values ($1) returning id", [chatId]);
  return result.rows[0]!.id;
}

async function insertPisoSubscription(subscriberId: number, storeId: number) {
  await admin.query("insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')", [subscriberId, storeId]);
}

async function pisoSubscriptionOf(chatId: number, storeSlug: string) {
  const result = await admin.query<{ mode: string; floor_value: string | null; floor_reward_type: string | null }>(
    `select s.mode, s.floor_value, s.floor_reward_type
     from public.subscriptions s
     join public.subscribers sub on sub.id = s.subscriber_id
     join public.stores st on st.id = s.store_id
     where sub.telegram_chat_id = $1 and st.slug = $2`,
    [chatId, storeSlug],
  );
  return result.rows[0] ?? null;
}

async function cleanPisoFixtures() {
  await admin.query("delete from public.subscribers where telegram_chat_id between $1 and $2", [PISO_CHAT, PISO_CHAT + 99]);
  await admin.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${pisoPrefix}%`]);
  await admin.query("delete from public.stores where slug like $1", [`${pisoPrefix}%`]);
}

beforeAll(async () => {
  await admin.connect();
  await bot.connect();
});

beforeEach(async () => {
  await cleanFixtures();
  await admin.query("insert into public.stores (slug, name) values ($1, $2)", [`${fixturePrefix}amazon`, "Amazon"]);
});

afterAll(async () => {
  await cleanFixtures();
  await admin.end();
  await bot.end();
});

describe("autenticação da borda", () => {
  it("recusa sem o header secreto, com 401 sem corpo e sem tocar no banco", async () => {
    const response = await createBotHandler({ pool: forbiddenPool, secretToken: SECRET, webhookPath: PATH, siteUrl: SITE })(
      request(update("/start"), { secret: null }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("recusa com o header secreto errado", async () => {
    const response = await createBotHandler({ pool: forbiddenPool, secretToken: SECRET, webhookPath: PATH, siteUrl: SITE })(
      request(update("/start"), { secret: "quase-certo" }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  // A URL é o segundo segredo (ADR-0065): caminho errado responde 401, não 404, para que sondar
  // não ensine nada sobre onde o webhook mora.
  it("recusa num caminho que não é o do webhook, sem distinguir de segredo errado", async () => {
    const response = await createBotHandler({ pool: forbiddenPool, secretToken: SECRET, webhookPath: PATH, siteUrl: SITE })(
      request(update("/start"), { path: "telegram-webhook" }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });
});

describe("/start", () => {
  it("cria a Inscrição em Modo melhoria e confirma a loja", async () => {
    const response = await handler()(request(update(`/start ${fixturePrefix}amazon`)));

    expect(response.status).toBe(200);
    const reply = await replyOf(response);
    expect(reply.method).toBe("sendMessage");
    expect(reply.chat_id).toBe(CHAT);
    expect(reply.text).toContain("Amazon");

    expect(await subscriptionsOfChat()).toEqual([{ slug: `${fixturePrefix}amazon`, mode: "improvement", floor_value: null }]);
  });

  it("resolve o slug de uma loja absorvida por um merge", async () => {
    const canonical = await admin.query<{ id: number }>("select id from public.stores where slug = $1", [`${fixturePrefix}amazon`]);
    await admin.query("insert into public.store_slug_redirects (from_slug, to_store_id) values ($1, $2)", [
      `${fixturePrefix}amazonbr`,
      canonical.rows[0]!.id,
    ]);

    await handler()(request(update(`/start ${fixturePrefix}amazonbr`)));

    expect(await subscriptionsOfChat()).toEqual([{ slug: `${fixturePrefix}amazon`, mode: "improvement", floor_value: null }]);
  });

  it("responde de forma útil a um slug inexistente, sem criar nada", async () => {
    const reply = await replyOf(await handler()(request(update(`/start ${fixturePrefix}naoexiste`))));

    expect(reply.text).toMatch(/não encontrei|nao encontrei/i);
    expect(reply.text).toContain(SITE);
    expect(await subscriptionsOfChat()).toEqual([]);
  });

  it("explica o bot e aponta o site quando vem sem slug, sem criar nada", async () => {
    const reply = await replyOf(await handler()(request(update("/start"))));

    expect(reply.text).toContain(SITE);
    expect(await subscriptionsOfChat()).toEqual([]);
  });

  it("repetir /start na mesma loja mantém uma Inscrição só", async () => {
    await handler()(request(update(`/start ${fixturePrefix}amazon`)));
    await handler()(request(update(`/start ${fixturePrefix}amazon`)));

    expect(await subscriptionsOfChat()).toHaveLength(1);
  });
});

describe("consentimento e privacidade (ADR-0066)", () => {
  it("a primeira resposta a um chat novo traz o consentimento informado e o link da política", async () => {
    const reply = await replyOf(await handler()(request(update(`/start ${fixturePrefix}amazon`))));

    expect(reply.text).toContain(`${SITE}/privacidade`);
    // Consentimento informado = O QUE é guardado + PARA QUÊ + COMO apagar, não só linkar a política.
    expect(reply.text).toMatch(/guard/i);
    expect(reply.text).toMatch(/avisar/i);
    expect(reply.text).toMatch(/\/parar/);
  });

  it("não repete o bloco de consentimento para quem já é Assinante", async () => {
    const first = await replyOf(await handler()(request(update(`/start ${fixturePrefix}amazon`))));
    await admin.query("insert into public.stores (slug, name) values ($1, $2)", [`${fixturePrefix}kabum`, "KaBuM"]);
    const second = await replyOf(await handler()(request(update(`/start ${fixturePrefix}kabum`))));

    expect(first.text).toContain(`${SITE}/privacidade`);
    expect(second.text).not.toContain("guardamos");
  });

  it("/privacidade devolve o link a qualquer momento", async () => {
    const reply = await replyOf(await handler()(request(update("/privacidade"))));

    expect(reply.text).toContain(`${SITE}/privacidade`);
    expect(await subscriptionsOfChat()).toEqual([]);
  });

  it("/parar cumpre a promessa da consentBlock: apaga o Assinante e as Inscrições, sem registro residual", async () => {
    await handler()(request(update(`/start ${fixturePrefix}amazon`)));

    const reply = await replyOf(await handler()(request(update("/parar"))));

    expect(reply.chat_id).toBe(CHAT);
    expect(await subscriptionsOfChat()).toEqual([]);
    const remaining = await admin.query("select id from public.subscribers where telegram_chat_id = $1", [CHAT]);
    expect(remaining.rows).toEqual([]);
  });

  it("/parar sem nenhuma Inscrição responde normalmente, sem erro", async () => {
    const response = await handler()(request(update("/parar")));

    expect(response.status).toBe(200);
  });
});

describe("dado mínimo (ADR-0066)", () => {
  it("não persiste nome, sobrenome, @ nem o texto da mensagem", async () => {
    await handler()(request(update(`/start ${fixturePrefix}amazon`)));

    const stored = await admin.query<Record<string, unknown>>(
      "select * from public.subscribers where telegram_chat_id = $1",
      [CHAT],
    );
    const serialized = JSON.stringify(stored.rows);

    for (const leak of ["Fulano", "de Tal", "fulano", "pt-br", "/start"]) {
      expect(serialized).not.toContain(leak);
    }
    // E a prova estrutural: a tabela não tem onde guardar nada disso.
    expect(Object.keys(stored.rows[0]!).sort()).toEqual(["created_at", "id", "last_notified_history_id", "telegram_chat_id"]);
  });

  it("ignora update sem mensagem de texto, sem criar nada", async () => {
    const response = await handler()(request({ update_id: 2, edited_message: { text: "oi" } }));

    expect(response.status).toBe(200);
    expect(await subscriptionsOfChat()).toEqual([]);
  });
});

describe("/piso (#117, ADR-0063)", () => {
  beforeEach(async () => {
    await cleanPisoFixtures();
  });

  afterAll(async () => {
    await cleanPisoFixtures();
  });

  it("define piso percentual com número puro e troca a Inscrição para Modo acompanhamento", async () => {
    const store = await insertPisoStore("amazon", "Amazon");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10`, PISO_CHAT))));

    expect(reply.text).toMatch(/10%/);
    expect(reply.text).toMatch(/acompanhamento/i);
    const subscription = await pisoSubscriptionOf(PISO_CHAT, store.slug);
    expect(subscription).toMatchObject({ mode: "tracking", floor_reward_type: "percent" });
    expect(Number(subscription!.floor_value)).toBe(10);
  });

  it("aceita '10%' explícito como piso percentual", async () => {
    const store = await insertPisoStore("kabum-pct", "KaBuM");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 1);
    await insertPisoSubscription(subscriberId, store.id);

    await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 1)));

    const subscription = await pisoSubscriptionOf(PISO_CHAT + 1, store.slug);
    expect(subscription).toMatchObject({ mode: "tracking", floor_reward_type: "percent" });
    expect(Number(subscription!.floor_value)).toBe(10);
  });

  it("define piso em reais com 'R$ 25'", async () => {
    const store = await insertPisoStore("betera", "Betera");
    await insertPisoOffer(store.id, "cuponomia", "fixed", 15);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 2);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} R$ 25`, PISO_CHAT + 2))));

    expect(reply.text).toMatch(/R\$\s*25/);
    const subscription = await pisoSubscriptionOf(PISO_CHAT + 2, store.slug);
    expect(subscription).toMatchObject({ mode: "tracking", floor_reward_type: "fixed" });
    expect(Number(subscription!.floor_value)).toBe(25);
  });

  it("define piso em reais com '25 reais'", async () => {
    const store = await insertPisoStore("truebet", "TrueBet");
    await insertPisoOffer(store.id, "cuponomia", "fixed", 15);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 3);
    await insertPisoSubscription(subscriberId, store.id);

    await handler()(request(update(`/piso ${store.slug} 25 reais`, PISO_CHAT + 3)));

    const subscription = await pisoSubscriptionOf(PISO_CHAT + 3, store.slug);
    expect(subscription).toMatchObject({ mode: "tracking", floor_reward_type: "fixed" });
    expect(Number(subscription!.floor_value)).toBe(25);
  });

  it("ajustar o valor depois faz UPDATE na mesma Inscrição, nunca recria a linha", async () => {
    const store = await insertPisoStore("magalu", "Magalu");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 4);
    await insertPisoSubscription(subscriberId, store.id);

    await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 4)));
    await handler()(request(update(`/piso ${store.slug} 15%`, PISO_CHAT + 4)));

    const rows = await admin.query(
      `select count(*)::int as count from public.subscriptions s
       join public.subscribers sub on sub.id = s.subscriber_id
       where sub.telegram_chat_id = $1 and s.store_id = $2`,
      [PISO_CHAT + 4, store.id],
    );
    expect(rows.rows[0].count).toBe(1);
    const subscription = await pisoSubscriptionOf(PISO_CHAT + 4, store.slug);
    expect(Number(subscription!.floor_value)).toBe(15);
  });

  it("valor inválido responde de forma útil e não altera a Inscrição existente", async () => {
    const store = await insertPisoStore("submarino", "Submarino");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 5);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} abacate`, PISO_CHAT + 5))));

    expect(reply.text).toMatch(/não entendi/i);
    const subscription = await pisoSubscriptionOf(PISO_CHAT + 5, store.slug);
    expect(subscription).toMatchObject({ mode: "improvement", floor_value: null, floor_reward_type: null });
  });

  it("comando sem loja nem valor responde de forma útil, sem tocar no banco", async () => {
    const reply = await replyOf(await handler()(request(update("/piso", PISO_CHAT + 6))));

    expect(reply.text).toMatch(/não entendi/i);
  });

  it("loja não assinada responde de forma útil, sem criar Inscrição", async () => {
    const store = await insertPisoStore("centauro", "Centauro");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    // Sem insertPisoSubscription: a loja existe, mas este assinante nunca deu /start nela.

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 7))));

    expect(reply.text).toMatch(/ainda não acompanha/i);
    expect(await pisoSubscriptionOf(PISO_CHAT + 7, store.slug)).toBeNull();
  });

  it("loja inexistente responde 'não encontrei', sem criar nada", async () => {
    const reply = await replyOf(await handler()(request(update(`/piso ${pisoPrefix}naoexiste 10%`, PISO_CHAT + 8))));

    expect(reply.text).toMatch(/não encontrei|nao encontrei/i);
  });

  it("sinaliza piso incompatível com a grandeza das ofertas correntes, sugere a unidade certa, e ainda assim grava", async () => {
    const store = await insertPisoStore("kalunga", "Kalunga");
    await insertPisoOffer(store.id, "cuponomia", "fixed", 15);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 9);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 9))));

    expect(reply.text).toMatch(/R\$/);
    // AC: sinaliza, não bloqueia — a ausência de mensagem é o pior modo de falha (ADR-0063).
    const subscription = await pisoSubscriptionOf(PISO_CHAT + 9, store.slug);
    expect(subscription).toMatchObject({ mode: "tracking", floor_reward_type: "percent" });
    expect(Number(subscription!.floor_value)).toBe(10);
  });

  it("não sinaliza incompatibilidade quando a grandeza casa com alguma oferta elegível, mesmo com outras plataformas em grandeza diferente", async () => {
    const store = await insertPisoStore("shoptime", "Shoptime");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    await insertPisoOffer(store.id, "cuponomia", "fixed", 15);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 10);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 10))));

    expect(reply.text).not.toMatch(/⚠️/);
  });

  it("sinaliza ausência de oferta elegível quando não há nenhuma (loja indisponível)", async () => {
    const store = await insertPisoStore("centercomp", "CenterComp");
    // Nenhuma oferta inserida: loja existe, mas sem Oferta pública elegível.
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 11);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 11))));

    expect(reply.text).toMatch(/⚠️/);
    expect(reply.text).toMatch(/não encontrei oferta/i);
  });

  it("consulta pela view pública (web_read.catalog_offers), não pela tabela crua: oferta fora do frescor de 48h não conta como elegível", async () => {
    const store = await insertPisoStore("extra", "Extra");
    // Oferta percentual existe na tabela crua, mas fora da janela de frescor (48h) — não é
    // Oferta pública elegível. Se o código consultasse a tabela crua em vez da view, este teste
    // falharia por não sinalizar incompatibilidade nenhuma.
    await insertPisoOffer(store.id, "meliuz", "percent", 5, { hoursOld: 72 });
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 12);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 10%`, PISO_CHAT + 12))));

    expect(reply.text).toMatch(/⚠️/);
    expect(reply.text).toMatch(/não encontrei oferta/i);
  });

  it("a resposta declara o estado resultante (modo e piso), nunca um 'ok' isolado", async () => {
    const store = await insertPisoStore("dafiti", "Dafiti");
    await insertPisoOffer(store.id, "meliuz", "percent", 5);
    const subscriberId = await insertPisoSubscriber(PISO_CHAT + 13);
    await insertPisoSubscription(subscriberId, store.id);

    const reply = await replyOf(await handler()(request(update(`/piso ${store.slug} 12,5%`, PISO_CHAT + 13))));

    expect(reply.text).toContain("Dafiti");
    expect(reply.text).toMatch(/acompanhamento/i);
    expect(reply.text).toMatch(/12,50%/);
    expect(reply.text?.trim().toLowerCase()).not.toBe("ok");
  });
});

describe("a fronteira da role", () => {
  it("o handler roda sob farejo_bot, que não enxerga o histórico de ofertas", async () => {
    await expect(bot.query("select * from public.offer_history")).rejects.toThrow(/permission denied/i);
    await expect(bot.query("select current_user")).resolves.toMatchObject({ rows: [{ current_user: "farejo_bot" }] });
  });
});
