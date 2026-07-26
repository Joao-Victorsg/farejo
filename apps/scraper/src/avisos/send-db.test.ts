import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendPendingAvisos, type AvisoTransport, type TransportOutcome } from "./send.js";

/**
 * F4/#114 (ADR-0063/ADR-0064) — seam do job de Avisos: entrypoint real contra o Postgres local,
 * sob a role REAL `farejo_notifier` (nunca `service_role`), com o transporte do Telegram
 * injetado. É o mesmo padrão do ingestor de logos: o valor está em provar a regra de domínio pelo
 * caminho de verdade, incluindo os grants.
 *
 * As Inscrições nascem por SQL — o bot (#116) ainda não existe, e não precisa existir para o
 * motor ser demonstrável.
 */
const adminUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const notifierUrl = `${adminUrl}?options=-c%20role%3Dfarejo_notifier`;
const fixturePrefix = "issue114avisos";
const CHAT_BASE = 911700;

const admin = new Client({ connectionString: adminUrl });
const notifier = new Client({ connectionString: notifierUrl });

interface SentMessage {
  chatId: string;
  text: string;
}

/** Transporte falso: registra o que sairia e permite programar o desfecho por chat. */
function transportSpy(outcomes: Record<string, TransportOutcome> = {}) {
  const sent: SentMessage[] = [];
  const transport: AvisoTransport = async ({ chatId, text }) => {
    sent.push({ chatId, text });
    return outcomes[chatId] ?? "sent";
  };
  return { transport, sent };
}

async function cleanFixtures() {
  await admin.query("delete from public.subscribers where telegram_chat_id between $1 and $2", [CHAT_BASE, CHAT_BASE + 99]);
  await admin.query("delete from public.offer_history where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await admin.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await admin.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

async function createStore(suffix: string, name: string): Promise<number> {
  const result = await admin.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [
    `${fixturePrefix}${suffix}`,
    name,
  ]);
  return result.rows[0]!.id;
}

/**
 * Uma linha de histórico. `changedAt` é explícito porque a baseline é o último valor não-nulo
 * ordenado no tempo — a ordem entre as linhas É o caso de teste.
 */
async function history(
  storeId: number,
  platformId: string,
  entry: { value: number | null; rewardType?: string; isUpto?: boolean; valuePartial?: number | null },
  changedAt: string,
) {
  // `offer_history` tem FK composta para `offers(store_id, platform_id)`: a série só existe
  // pendurada numa oferta. Os valores da oferta em si não participam da detecção — quem manda é
  // o histórico —, mas a linha precisa existir.
  await admin.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at)
     values ($1, $2, $3, coalesce($4::numeric, 0), 'fixture', 'https://example.test/issue114', true, now())
     on conflict (store_id, platform_id) do update set value = coalesce(excluded.value, public.offers.value)`,
    [storeId, platformId, entry.rewardType ?? "percent", entry.value],
  );
  await admin.query(
    `insert into public.offer_history (store_id, platform_id, reward_type, value, value_partial, is_upto, changed_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [storeId, platformId, entry.rewardType ?? "percent", entry.value, entry.valuePartial ?? null, entry.isUpto ?? false, changedAt],
  );
}

async function subscribe(
  chatId: number,
  storeId: number,
  subscription: { mode: "improvement" } | { mode: "tracking"; floorValue: number; floorRewardType: "percent" | "fixed" },
  // Default realista: DEPOIS da linha de baseline (07-01 00:00) e ANTES da transição (07-02).
  // Assinar uma loja antes de ela ter qualquer oferta é o caso da "oferta nova", que tem teste
  // próprio; usá-lo como padrão faria toda transição parecer estreia.
  createdAt = "2026-07-01T12:00:00Z",
): Promise<number> {
  const existing = await admin.query<{ id: number }>("select id from public.subscribers where telegram_chat_id = $1", [chatId]);
  const subscriberId =
    existing.rows[0]?.id ??
    (await admin.query<{ id: number }>("insert into public.subscribers (telegram_chat_id) values ($1) returning id", [chatId])).rows[0]!.id;

  const floorValue = subscription.mode === "tracking" ? subscription.floorValue : null;
  const floorRewardType = subscription.mode === "tracking" ? subscription.floorRewardType : null;
  await admin.query(
    `insert into public.subscriptions (subscriber_id, store_id, mode, floor_value, floor_reward_type, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [subscriberId, storeId, subscription.mode, floorValue, floorRewardType, createdAt],
  );
  return subscriberId;
}

async function cursorOf(subscriberId: number): Promise<string> {
  const result = await admin.query<{ last_notified_history_id: string }>(
    "select last_notified_history_id from public.subscribers where id = $1",
    [subscriberId],
  );
  return result.rows[0]!.last_notified_history_id;
}

beforeAll(async () => {
  await admin.connect();
  await notifier.connect();
});

beforeEach(async () => {
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await admin.end();
  await notifier.end();
});

describe("Modo melhoria — o que dispara e o que não dispara", () => {
  it("avisa quando o valor sobe", async () => {
    const store = await createStore("sobe", "Loja Sobe");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    const report = await sendPendingAvisos(notifier, transport);

    expect(report.avisosSent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Loja Sobe");
    expect(sent[0]!.text).toContain("3% → 5%");
  });

  it("não avisa quando o valor cai", async () => {
    const store = await createStore("cai", "Loja Cai");
    await history(store, "meliuz", { value: 5 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 3 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 1, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  it("avisa quando nasce uma oferta onde não havia nenhuma", async () => {
    const store = await createStore("nova", "Loja Nova");
    await subscribe(CHAT_BASE + 2, store, { mode: "improvement" });
    await history(store, "zoom", { value: 4 }, "2026-07-02T00:00:00Z");

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("novo");
    expect(sent[0]!.text).toContain("4%");
  });

  // A taxa de não-correntista do Inter grava linha de histórico (ADR-0011) sem mudar o que a
  // pessoa compara.
  it("não avisa quando só o value_partial muda", async () => {
    const store = await createStore("parcial", "Loja Parcial");
    await history(store, "inter", { value: 3, valuePartial: 1 }, "2026-07-01T00:00:00Z");
    await history(store, "inter", { value: 3, valuePartial: 2 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 3, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  it("não avisa quando a loja é desativada e volta com o mesmo valor", async () => {
    const store = await createStore("volta-igual", "Loja Volta Igual");
    await history(store, "cuponomia", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "cuponomia", { value: null }, "2026-07-02T00:00:00Z");
    await history(store, "cuponomia", { value: 3 }, "2026-07-03T00:00:00Z");
    await subscribe(CHAT_BASE + 4, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  it("avisa quando a loja volta com valor maior que antes de sumir", async () => {
    const store = await createStore("volta-maior", "Loja Volta Maior");
    await history(store, "cuponomia", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "cuponomia", { value: null }, "2026-07-02T00:00:00Z");
    await history(store, "cuponomia", { value: 6 }, "2026-07-03T00:00:00Z");
    await subscribe(CHAT_BASE + 5, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("3% → 6%");
  });

  it("não avisa quando a grandeza troca (percent ↔ fixed), que nunca se comparam", async () => {
    const store = await createStore("grandeza", "Loja Grandeza");
    await history(store, "meliuz", { value: 10, rewardType: "fixed" }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 20, rewardType: "percent" }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 6, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  // `is_upto` fica fora da comparação (o ranking público ordena up-to pelo valor), mas a mensagem
  // é obrigada a mostrar a natureza dos dois lados — senão afirma aumento onde o piso caiu.
  it("avisa em 5% → até 10% e mostra o \"até\" na mensagem", async () => {
    const store = await createStore("upto", "Loja Upto");
    await history(store, "meliuz", { value: 5, isUpto: false }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 10, isUpto: true }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 7, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("5% → até 10%");
  });
});

describe("Modo acompanhamento — o Piso decide", () => {
  it("avisa em qualquer direção enquanto aterrissar no Piso ou acima", async () => {
    const store = await createStore("piso-dentro", "Loja Piso");
    await history(store, "meliuz", { value: 12 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 14 }, "2026-07-02T00:00:00Z");
    await history(store, "meliuz", { value: 12 }, "2026-07-03T00:00:00Z");
    await subscribe(CHAT_BASE + 8, store, { mode: "tracking", floorValue: 10, floorRewardType: "percent" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toHaveLength(1);
    // As duas transições dentro da janela aterrissam acima do piso, e cada uma vira uma linha —
    // colapsar num degrau só esconderia a oscilação, que é justamente o que se quer avisar.
    expect(sent[0]!.text).toContain("12% → 14%");
    expect(sent[0]!.text).toContain("14% → 12%");
  });

  it("silencia a queda que sai do Piso e o fim da oferta", async () => {
    const store = await createStore("piso-fora", "Loja Fora do Piso");
    await history(store, "meliuz", { value: 12 }, "2026-07-01T00:00:00Z");
    await subscribe(CHAT_BASE + 9, store, { mode: "tracking", floorValue: 10, floorRewardType: "percent" }, "2026-07-02T00:00:00Z");
    await history(store, "meliuz", { value: 8 }, "2026-07-03T00:00:00Z");
    await history(store, "meliuz", { value: null }, "2026-07-04T00:00:00Z");

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  it("avisa quando a oferta marca exatamente o Piso — piso é chão, não linha a ultrapassar", async () => {
    const store = await createStore("piso-exato", "Loja Piso Exato");
    await history(store, "meliuz", { value: 4 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 10 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 10, store, { mode: "tracking", floorValue: 10, floorRewardType: "percent" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toHaveLength(1);
  });

  it("ignora a grandeza que não é a do Piso", async () => {
    const store = await createStore("piso-tipo", "Loja Piso Tipo");
    await history(store, "meliuz", { value: 50, rewardType: "fixed" }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 11, store, { mode: "tracking", floorValue: 10, floorRewardType: "percent" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });
});

describe("Aviso — um por assinante, por run", () => {
  it("agrupa várias lojas e plataformas numa mensagem só", async () => {
    const amazon = await createStore("amazon", "Amazon");
    const kabum = await createStore("kabum", "KaBuM");
    await history(amazon, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(amazon, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    await history(amazon, "zoom", { value: 7 }, "2026-07-02T00:00:00Z");
    await history(kabum, "cuponomia", { value: 2 }, "2026-07-01T00:00:00Z");
    await history(kabum, "cuponomia", { value: 4 }, "2026-07-02T00:00:00Z");

    const chat = CHAT_BASE + 12;
    await subscribe(chat, amazon, { mode: "improvement" });
    await subscribe(chat, kabum, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    const report = await sendPendingAvisos(notifier, transport);

    expect(report.avisosSent).toBe(1);
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;
    expect(text).toContain("Amazon");
    expect(text).toContain("KaBuM");
    expect(text).toContain("3% → 5%");
    expect(text).toContain("2% → 4%");
    // Agrupado por loja: cada nome aparece uma vez só, com as plataformas embaixo.
    expect(text.match(/Amazon/g)).toHaveLength(1);
  });

  it("não entrega transições anteriores à criação da Inscrição", async () => {
    const store = await createStore("antes", "Loja Antes");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 9 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 13, store, { mode: "improvement" }, "2026-07-03T00:00:00Z");

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
  });

  it("formata reais e decimais em pt-BR, sem zero à direita inútil", async () => {
    const fixed = await createStore("reais", "Loja Reais");
    const percent = await createStore("decimal", "Loja Decimal");
    await history(fixed, "meliuz", { value: 10.5, rewardType: "fixed" }, "2026-07-01T00:00:00Z");
    await history(fixed, "meliuz", { value: 25, rewardType: "fixed" }, "2026-07-02T00:00:00Z");
    await history(percent, "zoom", { value: 2 }, "2026-07-01T00:00:00Z");
    await history(percent, "zoom", { value: 4.5 }, "2026-07-02T00:00:00Z");

    const chat = CHAT_BASE + 20;
    await subscribe(chat, fixed, { mode: "improvement" });
    await subscribe(chat, percent, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent[0]!.text).toContain("R$ 10,50 → R$ 25");
    expect(sent[0]!.text).toContain("2% → 4,50%");
  });

  it("manda texto puro, sem parse_mode e sem markup", async () => {
    const store = await createStore("texto", "Loja & Cia <b>");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    await subscribe(CHAT_BASE + 14, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    // O nome da loja entra cru: sem parse_mode não há markup para escapar nem para injetar.
    expect(sent[0]!.text).toContain("Loja & Cia <b>");
  });
});

describe("cursor e entrega", () => {
  it("avança o cursor só quando o envio dá certo, e acumula o lote na falha", async () => {
    const store = await createStore("cursor", "Loja Cursor");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    const chat = CHAT_BASE + 15;
    const subscriberId = await subscribe(chat, store, { mode: "improvement" });

    const failing = transportSpy({ [String(chat)]: "failed" });
    await sendPendingAvisos(notifier, failing.transport);
    expect(failing.sent).toHaveLength(1);
    expect(await cursorOf(subscriberId)).toBe("0");

    // Run seguinte: mais uma subida. O lote acumulado sai junto, sem duplicar nada.
    await history(store, "meliuz", { value: 8 }, "2026-07-03T00:00:00Z");
    const ok = transportSpy();
    await sendPendingAvisos(notifier, ok.transport);
    expect(ok.sent).toHaveLength(1);
    // O lote acumulado mostra o caminho inteiro, não só o saldo.
    expect(ok.sent[0]!.text).toContain("3% → 5%");
    expect(ok.sent[0]!.text).toContain("5% → 8%");
    expect(await cursorOf(subscriberId)).not.toBe("0");

    // E um terceiro run, sem novidade, não manda nada.
    const quiet = transportSpy();
    await sendPendingAvisos(notifier, quiet.transport);
    expect(quiet.sent).toEqual([]);
  });

  it("avança o cursor de quem não tem nada a receber, para a janela não crescer para sempre", async () => {
    const store = await createStore("quieto", "Loja Quieta");
    await history(store, "meliuz", { value: 5 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 3 }, "2026-07-02T00:00:00Z");
    const subscriberId = await subscribe(CHAT_BASE + 16, store, { mode: "improvement" });

    const { transport, sent } = transportSpy();
    await sendPendingAvisos(notifier, transport);

    expect(sent).toEqual([]);
    expect(await cursorOf(subscriberId)).not.toBe("0");
  });

  it("uma falha de envio não impede a entrega aos demais", async () => {
    const store = await createStore("varios", "Loja Vários");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    const doomed = CHAT_BASE + 17;
    const healthy = CHAT_BASE + 18;
    await subscribe(doomed, store, { mode: "improvement" });
    const healthyId = await subscribe(healthy, store, { mode: "improvement" });

    const { transport, sent } = transportSpy({ [String(doomed)]: "failed" });
    const report = await sendPendingAvisos(notifier, transport);

    expect(sent.map((message) => message.chatId).sort()).toEqual([String(doomed), String(healthy)].sort());
    expect(report.avisosSent).toBe(1);
    expect(report.sendFailures).toBe(1);
    expect(await cursorOf(healthyId)).not.toBe("0");
  });

  it("apaga o Assinante que revogou (bloqueio ou chat inexistente), com as Inscrições junto", async () => {
    const store = await createStore("revogado", "Loja Revogada");
    await history(store, "meliuz", { value: 3 }, "2026-07-01T00:00:00Z");
    await history(store, "meliuz", { value: 5 }, "2026-07-02T00:00:00Z");
    const chat = CHAT_BASE + 19;
    const subscriberId = await subscribe(chat, store, { mode: "improvement" });

    const { transport } = transportSpy({ [String(chat)]: "revoked" });
    const report = await sendPendingAvisos(notifier, transport);

    expect(report.subscribersRemoved).toBe(1);
    await expect(admin.query("select 1 from public.subscribers where id = $1", [subscriberId])).resolves.toMatchObject({ rowCount: 0 });
    await expect(admin.query("select 1 from public.subscriptions where subscriber_id = $1", [subscriberId])).resolves.toMatchObject({ rowCount: 0 });
  });
});
