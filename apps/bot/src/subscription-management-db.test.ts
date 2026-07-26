import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBotHandler } from "./handler.js";
import { ALLOWED_UPDATE_TYPES, TelegramUpdate } from "./update.js";

/**
 * F4/#118 (ADR-0064/ADR-0065/ADR-0066) — gestão de Inscrições, revogação e teto por Assinante:
 * `/lojas`, `/parar <slug>` seletivo, teto de 10, update `my_chat_member` (bloqueio), `/ajuda` e a
 * resposta constante a entrada não reconhecida. Mesma seam de `handler-db.test.ts` (`Request` real
 * → `createBotHandler` → Postgres local sob a role REAL `farejo_bot`), arquivo separado para não
 * colidir com o #117 concorrente na mesma faixa de arquivo.
 */
const adminUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const botUrl = `${adminUrl}?options=-c%20role%3Dfarejo_bot`;
const fixturePrefix = "issue118bot";
const CHAT_MIN = 918100;
const CHAT_MAX = 918199;

const admin = new Client({ connectionString: adminUrl });
const bot = new Client({ connectionString: botUrl });

const SECRET = "segredo-de-teste-do-webhook-118";
const PATH = "tg-issue118";
const SITE = "https://farejo.test";

const handler = () => createBotHandler({ pool: bot, secretToken: SECRET, webhookPath: PATH, siteUrl: SITE });

function messageUpdate(text: string, chatId: number) {
  return {
    update_id: 1,
    message: {
      message_id: 7,
      date: 1785000000,
      chat: { id: chatId, type: "private", first_name: "Fulano", last_name: "de Tal", username: "fulano" },
      from: { id: chatId, is_bot: false, first_name: "Fulano", username: "fulano", language_code: "pt-br" },
      text,
    },
  };
}

function chatMemberUpdate(chatId: number, status: string) {
  return {
    update_id: 2,
    my_chat_member: {
      chat: { id: chatId, type: "private", first_name: "Fulano" },
      from: { id: chatId, is_bot: false, first_name: "Fulano", username: "fulano" },
      date: 1785000000,
      old_chat_member: { user: { id: 999999, is_bot: true, first_name: "farejoBot" }, status: "member" },
      new_chat_member: { user: { id: 999999, is_bot: true, first_name: "farejoBot" }, status },
    },
  };
}

function request(body: unknown) {
  const headers = new Headers({ "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET });
  return new Request(`https://bot.farejo.test/api/${PATH}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function replyOf(response: Response): Promise<{ method?: string; chat_id?: number; text?: string }> {
  return (await response.json()) as { method?: string; chat_id?: number; text?: string };
}

async function subscriptionsOfChat(chatId: number) {
  const result = await admin.query<{ slug: string; mode: string }>(
    `select st.slug, s.mode
     from public.subscriptions s
     join public.subscribers sub on sub.id = s.subscriber_id
     join public.stores st on st.id = s.store_id
     where sub.telegram_chat_id = $1
     order by st.slug`,
    [chatId],
  );
  return result.rows;
}

async function subscriberExists(chatId: number): Promise<boolean> {
  const result = await admin.query("select id from public.subscribers where telegram_chat_id = $1", [chatId]);
  return result.rows.length > 0;
}

async function insertStores(...pairs: Array<[slug: string, name: string]>) {
  for (const [slug, name] of pairs) {
    await admin.query("insert into public.stores (slug, name) values ($1, $2)", [slug, name]);
  }
}

async function cleanFixtures() {
  await admin.query("delete from public.subscribers where telegram_chat_id between $1 and $2", [CHAT_MIN, CHAT_MAX]);
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
});

afterAll(async () => {
  await cleanFixtures();
  await admin.end();
  await bot.end();
});

describe("/lojas", () => {
  const CHAT = 918100;

  it("sem nenhuma Inscrição, explica como criar", async () => {
    const reply = await replyOf(await handler()(request(messageUpdate("/lojas", CHAT))));

    expect(reply.text).toMatch(/\/start/);
    expect(reply.text).toContain(SITE);
  });

  it("lista as Inscrições com modo e Piso", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"], [`${fixturePrefix}kabum`, "KaBuM"]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));
    await handler()(request(messageUpdate(`/start ${fixturePrefix}kabum`, CHAT)));

    const subscriber = await admin.query<{ id: number }>("select id from public.subscribers where telegram_chat_id = $1", [CHAT]);
    const kabum = await admin.query<{ id: number }>("select id from public.stores where slug = $1", [`${fixturePrefix}kabum`]);
    await admin.query(
      "update public.subscriptions set mode = 'tracking', floor_value = 10, floor_reward_type = 'percent' where subscriber_id = $1 and store_id = $2",
      [subscriber.rows[0]!.id, kabum.rows[0]!.id],
    );

    const reply = await replyOf(await handler()(request(messageUpdate("/lojas", CHAT))));

    expect(reply.text).toContain("Amazon");
    expect(reply.text).toMatch(/melhoria/);
    expect(reply.text).toContain("KaBuM");
    expect(reply.text).toMatch(/acompanhamento/);
    expect(reply.text).toMatch(/10%/);
  });
});

describe("/parar <slug>", () => {
  const CHAT = 918110;

  it("remove só a Inscrição daquela loja, preservando as outras", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"], [`${fixturePrefix}kabum`, "KaBuM"]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));
    await handler()(request(messageUpdate(`/start ${fixturePrefix}kabum`, CHAT)));

    const reply = await replyOf(await handler()(request(messageUpdate(`/parar ${fixturePrefix}amazon`, CHAT))));

    expect(reply.text).toContain("Amazon");
    expect(await subscriptionsOfChat(CHAT)).toEqual([{ slug: `${fixturePrefix}kabum`, mode: "improvement" }]);
    expect(await subscriberExists(CHAT)).toBe(true);
  });

  it("resolve o slug de uma loja absorvida por um merge", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"]);
    const canonical = await admin.query<{ id: number }>("select id from public.stores where slug = $1", [`${fixturePrefix}amazon`]);
    await admin.query("insert into public.store_slug_redirects (from_slug, to_store_id) values ($1, $2)", [
      `${fixturePrefix}amazonbr`,
      canonical.rows[0]!.id,
    ]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));

    const reply = await replyOf(await handler()(request(messageUpdate(`/parar ${fixturePrefix}amazonbr`, CHAT))));

    expect(reply.text).toContain("Amazon");
    expect(await subscriptionsOfChat(CHAT)).toEqual([]);
  });

  it("loja existente mas não inscrita responde de forma útil, sem apagar nada", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"], [`${fixturePrefix}kabum`, "KaBuM"]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));

    const reply = await replyOf(await handler()(request(messageUpdate(`/parar ${fixturePrefix}kabum`, CHAT))));

    expect(reply.text).toContain("KaBuM");
    expect(await subscriptionsOfChat(CHAT)).toEqual([{ slug: `${fixturePrefix}amazon`, mode: "improvement" }]);
  });

  it("slug inexistente responde de forma útil", async () => {
    const reply = await replyOf(await handler()(request(messageUpdate(`/parar ${fixturePrefix}naoexiste`, CHAT))));

    expect(reply.text).toMatch(/não encontrei|nao encontrei/i);
  });
});

describe("teto de 10 Inscrições (ADR-0065)", () => {
  const CHAT = 918120;

  it("recusa a 11ª com resposta útil e mantém as 10 anteriores intactas", async () => {
    const slugs = Array.from({ length: 11 }, (_, index) => `${fixturePrefix}cap${index}`);
    await insertStores(...slugs.map((slug): [string, string] => [slug, slug]));

    for (const slug of slugs.slice(0, 10)) {
      const reply = await replyOf(await handler()(request(messageUpdate(`/start ${slug}`, CHAT))));
      expect(reply.text).toMatch(/Vou te avisar/);
    }
    expect(await subscriptionsOfChat(CHAT)).toHaveLength(10);

    const eleventh = await replyOf(await handler()(request(messageUpdate(`/start ${slugs[10]}`, CHAT))));

    expect(eleventh.text).not.toMatch(/Vou te avisar quando o cashback/);
    expect(eleventh.text).toMatch(/10/);
    expect(eleventh.text).toMatch(/\/parar/);
    const after = await subscriptionsOfChat(CHAT);
    expect(after).toHaveLength(10);
    expect(after.map((row) => row.slug)).not.toContain(slugs[10]);
  });

  it("repetir /start numa loja já inscrita continua funcionando mesmo exatamente no teto", async () => {
    const slugs = Array.from({ length: 10 }, (_, index) => `${fixturePrefix}capb${index}`);
    await insertStores(...slugs.map((slug): [string, string] => [slug, slug]));
    for (const slug of slugs) {
      await handler()(request(messageUpdate(`/start ${slug}`, CHAT)));
    }
    expect(await subscriptionsOfChat(CHAT)).toHaveLength(10);

    const reply = await replyOf(await handler()(request(messageUpdate(`/start ${slugs[0]}`, CHAT))));

    expect(reply.text).toMatch(/Vou te avisar/);
    expect(await subscriptionsOfChat(CHAT)).toHaveLength(10);
  });
});

describe("update my_chat_member (ADR-0066)", () => {
  const CHAT = 918130;

  it("status kicked apaga o Assinante e as Inscrições imediatamente, sem resposta", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));
    expect(await subscriberExists(CHAT)).toBe(true);

    const response = await handler()(request(chatMemberUpdate(CHAT, "kicked")));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await subscriberExists(CHAT)).toBe(false);
    expect(await subscriptionsOfChat(CHAT)).toEqual([]);
  });

  it("outros status (ex.: member) não apagam nada", async () => {
    await insertStores([`${fixturePrefix}amazon`, "Amazon"]);
    await handler()(request(messageUpdate(`/start ${fixturePrefix}amazon`, CHAT)));

    const response = await handler()(request(chatMemberUpdate(CHAT, "member")));

    expect(response.status).toBe(200);
    expect(await subscriberExists(CHAT)).toBe(true);
  });

  it("kicked para um chat sem Assinante não falha", async () => {
    const response = await handler()(request(chatMemberUpdate(CHAT, "kicked")));

    expect(response.status).toBe(200);
  });
});

describe("/ajuda", () => {
  it("lista os comandos disponíveis", async () => {
    const reply = await replyOf(await handler()(request(messageUpdate("/ajuda", 918140))));

    for (const cmd of ["/start", "/parar", "/lojas", "/privacidade", "/ajuda"]) {
      expect(reply.text).toContain(cmd);
    }
  });
});

describe("entrada não reconhecida", () => {
  const CHAT = 918150;

  it("responde sempre a mesma frase curta, sem ecoar o texto recebido", async () => {
    const first = await replyOf(await handler()(request(messageUpdate("blablabla texto aleatorio", CHAT))));
    const second = await replyOf(await handler()(request(messageUpdate("outro texto bem diferente 12345", CHAT))));

    expect(first.text).toBe(second.text);
    expect(first.text).not.toContain("blablabla");
    expect(second.text).not.toContain("outro texto bem diferente");
  });
});

describe("allowlist do update (ADR-0065/ADR-0066)", () => {
  it("ALLOWED_UPDATE_TYPES é exatamente message e my_chat_member, o valor de allowed_updates do setWebhook", () => {
    expect(ALLOWED_UPDATE_TYPES).toEqual(["message", "my_chat_member"]);
  });

  it("descarta o usuário embutido em my_chat_member.new_chat_member, mantendo só o status", () => {
    const parsed = TelegramUpdate.parse({
      my_chat_member: {
        chat: { id: 1 },
        from: { id: 999, is_bot: true, first_name: "farejoBot", username: "farejo_bot" },
        date: 1785000000,
        old_chat_member: { user: { id: 999, is_bot: true, first_name: "farejoBot" }, status: "member" },
        new_chat_member: { user: { id: 999, is_bot: true, first_name: "farejoBot", username: "farejo_bot" }, status: "kicked" },
      },
    });

    expect(parsed.my_chat_member).toEqual({ chat: { id: 1 }, new_chat_member: { status: "kicked" } });
  });
});
