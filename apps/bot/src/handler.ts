import { timingSafeEqual } from "node:crypto";
import type { BotPool } from "./db.js";
import { currentOfferRewardTypes, deleteSubscriber, ensureSubscription, resolveStore, setSubscriptionFloor, upsertSubscriber } from "./db.js";
import { floorMismatchHint, parseFloorValue, splitPisoArgument } from "./floor.js";
import { confirmSubscription, consentBlock, fallback, floorSet, invalidFloorValue, notSubscribed, privacy, stopped, storeNotFound, welcome } from "./replies.js";
import { parseCommand, TelegramUpdate } from "./update.js";

export interface BotHandlerConfig {
  pool: BotPool;
  secretToken: string;
  webhookPath: string;
  siteUrl: string;
}

/**
 * F4/#116 (ADR-0064/ADR-0065/ADR-0066) — o handler HTTP do bot, framework-agnostic (`Request` →
 * `Response`) para ser testável sem mock e reutilizável entre o entrypoint da Vercel e os testes.
 *
 * O caminho E o segredo são checados ANTES de qualquer outra coisa, e os dois falham do mesmo
 * jeito — 401 sem corpo — porque a URL é o segundo segredo (ADR-0065): um caminho errado não pode
 * ensinar "quase, só falta o header" nem um segredo errado ensinar "o caminho está certo".
 */
export function createBotHandler(config: BotHandlerConfig): (request: Request) => Promise<Response> {
  const { pool, secretToken, webhookPath, siteUrl } = config;
  const expectedPath = `/api/${webhookPath}`;
  const expectedSecret = Buffer.from(secretToken);

  return async function handleWebhook(request: Request): Promise<Response> {
    const pathOk = new URL(request.url).pathname === expectedPath;

    const providedSecret = request.headers.get("x-telegram-bot-api-secret-token");
    const providedBuffer = providedSecret === null ? null : Buffer.from(providedSecret);
    const secretOk =
      providedBuffer !== null && providedBuffer.byteLength === expectedSecret.byteLength && timingSafeEqual(providedBuffer, expectedSecret);

    if (!pathOk || !secretOk) return new Response(null, { status: 401 });

    const body: unknown = await request.json().catch(() => null);
    const parsed = TelegramUpdate.safeParse(body);
    const message = parsed.success ? parsed.data.message : undefined;

    // Update sem mensagem de texto (ex.: edited_message, membro entrando/saindo): não sabemos
    // tratar, então só confirmamos recebimento. Um não-2xx faria o Bot API reenviar para sempre.
    if (!message) return new Response(null, { status: 200 });

    const chatId = message.chat.id;
    const command = parseCommand(message.text);

    let text: string;
    if (command?.command === "/start") text = await handleStart(pool, siteUrl, chatId, command.argument);
    else if (command?.command === "/piso") text = await handlePiso(pool, siteUrl, chatId, command.argument);
    else if (command?.command === "/privacidade") text = privacy(siteUrl);
    else if (command?.command === "/parar") text = await handleStop(pool, chatId);
    else text = fallback(siteUrl);

    return Response.json({ method: "sendMessage", chat_id: chatId, text });
  };
}

async function handleStart(pool: BotPool, siteUrl: string, chatId: number, slug: string | undefined): Promise<string> {
  if (!slug) return welcome(siteUrl);

  const store = await resolveStore(pool, slug);
  if (!store) return storeNotFound(siteUrl);

  const subscriber = await upsertSubscriber(pool, chatId);
  await ensureSubscription(pool, subscriber.id, store.id);

  const confirmation = confirmSubscription(store.name);
  return subscriber.isNew ? `${consentBlock(siteUrl)}\n\n${confirmation}` : confirmation;
}

async function handleStop(pool: BotPool, chatId: number): Promise<string> {
  await deleteSubscriber(pool, chatId);
  return stopped();
}

/**
 * F4/#117 (ADR-0063) — `/piso <slug> <valor>` troca a Inscrição para Modo acompanhamento. A ordem
 * das checagens sobe de custo: gramática (pura, sem banco) → resolver a loja → só então gravar —
 * um comando malformado nunca chega a abrir uma query.
 */
async function handlePiso(pool: BotPool, siteUrl: string, chatId: number, argument: string | undefined): Promise<string> {
  const split = splitPisoArgument(argument);
  if (!split) return invalidFloorValue();

  const floor = parseFloorValue(split.valueText);
  if (!floor) return invalidFloorValue();

  const store = await resolveStore(pool, split.slug);
  if (!store) return storeNotFound(siteUrl);

  const updated = await setSubscriptionFloor(pool, chatId, store.id, floor);
  if (!updated) return notSubscribed(store.name);

  const eligibleTypes = await currentOfferRewardTypes(pool, store.slug);
  return floorSet(store.name, floor, floorMismatchHint(floor.rewardType, eligibleTypes));
}
