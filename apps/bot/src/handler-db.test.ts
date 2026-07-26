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

describe("a fronteira da role", () => {
  it("o handler roda sob farejo_bot, que não enxerga o histórico de ofertas", async () => {
    await expect(bot.query("select * from public.offer_history")).rejects.toThrow(/permission denied/i);
    await expect(bot.query("select current_user")).resolves.toMatchObject({ rows: [{ current_user: "farejo_bot" }] });
  });
});
