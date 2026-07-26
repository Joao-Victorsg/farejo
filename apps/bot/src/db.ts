import { z } from "zod";
import type { FloorRewardType, ParsedFloor } from "./floor.js";

/**
 * F4/#116 (ADR-0064) — as únicas queries que o handler faz, todas sob `farejo_bot`.
 *
 * Cada função é uma operação do domínio, não uma query genérica: quem lê o handler enxerga
 * "resolve a loja", "garante o assinante", "cria a inscrição" — não SQL solto espalhado pelo
 * dispatch de comandos.
 *
 * Toda linha que volta do Postgres é dado externo como qualquer outro (mesma disciplina de
 * `apps/scraper/src/avisos/send.ts` e `apps/web/src/lib/catalog.ts`): valida com zod ANTES de
 * virar tipo de domínio. `.parse()` (não `.safeParse()`) porque cada função aqui busca no máximo
 * uma linha (ou, em `currentOfferRewardTypes`, um punhado por loja — nunca um lote de terceiro)
 * para o próprio request — uma linha fora do contrato é defeito nosso, e deve estourar alto em
 * vez de ser silenciosamente descartada.
 */
export interface BotPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ResolvedStore {
  id: number;
  name: string;
  // Slug CANÔNICO (pós-redirect): #117 precisa dele para consultar `web_read.catalog_offers`,
  // que é chaveada por `store_slug`, não por id.
  slug: string;
}

const RedirectRow = z.object({ to_slug: z.string() });
// `id` é `bigint`: o driver `pg` devolve como string para não perder precisão. `z.coerce.number()`
// é o mesmo padrão de `apps/scraper/src/avisos/send.ts` (`subscriber_id`) para o mesmo motivo.
const StoreRow = z.object({ id: z.coerce.number().int(), name: z.string() });

/**
 * Resolve pelo `web_read.store_redirects` antes de `stores.slug` (ADR-0063): um link antigo de
 * loja absorvida por um merge precisa continuar funcionando. `farejo_bot` só tem SELECT nas duas,
 * nunca em `store_slug_redirects` diretamente — a view pública já é a definição certa.
 */
export async function resolveStore(pool: BotPool, slug: string): Promise<ResolvedStore | null> {
  const redirect = await pool.query<unknown>("select to_slug from web_read.store_redirects where from_slug = $1", [slug]);
  const canonicalSlug = RedirectRow.nullable().parse(redirect.rows[0] ?? null)?.to_slug ?? slug;

  const store = await pool.query<unknown>("select id, name from public.stores where slug = $1", [canonicalSlug]);
  const row = StoreRow.nullable().parse(store.rows[0] ?? null);
  return row ? { id: row.id, name: row.name, slug: canonicalSlug } : null;
}

export interface UpsertedSubscriber {
  id: number;
  isNew: boolean;
}

const SubscriberIdRow = z.object({ id: z.coerce.number().int() });

/**
 * `farejo_bot` tem `select, insert, delete` em `subscribers` — de propósito, sem `update`
 * (ADR-0064): nada no caminho público precisa alterar uma linha existente, só criar ou apagar.
 * Isso descarta o idioma `xmax = 0` de `on conflict ... do update`, porque o próprio `do update`
 * já exige o privilégio que a role não tem. `do nothing` não exige `update`, então "é a primeira
 * vez que este chat fala com o bot" sai de um segundo SELECT só quando o INSERT não devolveu
 * linha — mais uma ida ao banco no caminho de conflito, mas sob o mesmo grant mínimo.
 */
export async function upsertSubscriber(pool: BotPool, telegramChatId: number): Promise<UpsertedSubscriber> {
  const inserted = await pool.query<unknown>(
    `insert into public.subscribers (telegram_chat_id) values ($1)
     on conflict (telegram_chat_id) do nothing
     returning id`,
    [telegramChatId],
  );
  const insertedRow = SubscriberIdRow.nullable().parse(inserted.rows[0] ?? null);
  if (insertedRow) return { id: insertedRow.id, isNew: true };

  const existing = await pool.query<unknown>("select id from public.subscribers where telegram_chat_id = $1", [telegramChatId]);
  return { id: SubscriberIdRow.parse(existing.rows[0]).id, isNew: false };
}

/**
 * `/start` cria em **Modo melhoria** sem perguntar nada (ADR-0064). `do nothing` na colisão: um
 * `/start` repetido preserva o que já existe — inclusive um Piso que a pessoa tenha definido
 * depois (#117), que `/start` não tem por que desfazer.
 */
export async function ensureSubscription(pool: BotPool, subscriberId: number, storeId: number): Promise<void> {
  await pool.query(
    `insert into public.subscriptions (subscriber_id, store_id, mode) values ($1, $2, 'improvement')
     on conflict (subscriber_id, store_id) do nothing`,
    [subscriberId, storeId],
  );
}

/**
 * `/parar` sem argumento é a única promessa de eliminação que a consentBlock faz (ADR-0066: "é
 * DELETE, não flag"), e por isso é a única fatia da gestão de Inscrições que nasce aqui — o resto
 * (`/parar <slug>` seletivo, teto de 10, `/lojas`, `/ajuda`, `my_chat_member kicked`) é #118.
 * A FK de `subscriptions` para `subscribers` tem cascade (#113): uma linha apaga as duas.
 */
export async function deleteSubscriber(pool: BotPool, telegramChatId: number): Promise<boolean> {
  const deleted = await pool.query<unknown>("delete from public.subscribers where telegram_chat_id = $1 returning id", [telegramChatId]);
  return deleted.rows.length > 0;
}

const CurrentOfferRow = z.object({ reward_type: z.enum(["percent", "fixed"]) });

/**
 * Grandezas com ao menos uma Oferta pública elegível da loja, na MESMA definição do catálogo
 * (`web_read.catalog_offers`: `active = true` e frescor de 48 h, ADR-0064) — nunca a tabela
 * `public.offers` crua, que `farejo_bot` nem enxerga (#117). Lendo a tabela crua o bot confirmaria
 * um piso contra oferta que o site já considera expirada: duas definições de "oferta válida" no
 * mesmo produto.
 */
export async function currentOfferRewardTypes(pool: BotPool, storeSlug: string): Promise<Set<FloorRewardType>> {
  const result = await pool.query<unknown>("select distinct reward_type from web_read.catalog_offers where store_slug = $1", [storeSlug]);
  return new Set(result.rows.map((row) => CurrentOfferRow.parse(row).reward_type));
}

/**
 * Ajusta o Piso de uma Inscrição já existente — sempre UPDATE, nunca INSERT (#117). `/piso` não
 * cria Inscrição: ela só nasce no `/start` (`ensureSubscription` acima), então rodar o comando
 * numa loja nunca assinada devolve `false` em vez de inventar Modo e Piso do nada — a UI não tem
 * como saber se a pessoa quis dizer aquilo. Ajustar o valor depois é outro UPDATE na mesma chave
 * primária `(subscriber_id, store_id)`, nunca recria a linha.
 */
export async function setSubscriptionFloor(pool: BotPool, telegramChatId: number, storeId: number, floor: ParsedFloor): Promise<boolean> {
  const result = await pool.query<unknown>(
    `update public.subscriptions s
     set mode = 'tracking', floor_value = $1, floor_reward_type = $2
     from public.subscribers sub
     where sub.id = s.subscriber_id
       and sub.telegram_chat_id = $3
       and s.store_id = $4
     returning s.store_id`,
    [floor.value, floor.rewardType, telegramChatId, storeId],
  );
  return result.rows.length > 0;
}
