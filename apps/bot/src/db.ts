import { z } from "zod";

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
 * uma linha para o próprio request — uma linha fora do contrato é defeito nosso, não dado de
 * terceiro num lote, e deve estourar alto em vez de ser silenciosamente descartada.
 */
export interface BotPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ResolvedStore {
  id: number;
  name: string;
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
  return row ? { id: row.id, name: row.name } : null;
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

export type EnsureSubscriptionResult = "created" | "exists" | "capped";

/** ADR-0065: sem teto, uma conta assina o catálogo inteiro e vira amplificador. */
const SUBSCRIPTION_CAP = 10;

/**
 * `/start` cria em **Modo melhoria** sem perguntar nada (ADR-0064). `do nothing` na colisão: um
 * `/start` repetido preserva o que já existe — inclusive um Piso que a pessoa tenha definido
 * depois (#117), que `/start` não tem por que desfazer.
 *
 * O teto de 10 é verificado DENTRO do mesmo `insert...select...where`, não em um `SELECT count(*)`
 * separado antes do insert: `BotPool` é só `{query}`, e em produção é um `pg.Pool` de verdade — duas
 * chamadas `.query()` sequenciais não compartilham sessão nem transação implícita, cada uma pode
 * pegar uma conexão diferente do pool. Um `BEGIN`/`SELECT`/`INSERT`/`COMMIT` fatiado em `.query()`s
 * separadas SÓ pareceria atômico contra o `Client` único dos testes. Aqui a contagem é uma subquery
 * do PRÓPRIO comando: um round-trip, uma instrução, atômica por construção do Postgres,
 * independente de qual conexão do pool a atende.
 *
 * `on conflict do nothing` nunca devolve linha em conflito (mesmo motivo de `upsertSubscriber`), e
 * isso teria uma ambiguidade se o teto entrasse só no `where`: uma repetição de `/start` numa loja
 * já inscrita, com o Assinante EXATAMENTE no teto, cairia no mesmo "nenhuma linha voltou" que um
 * recusado por teto de verdade. Por isso o SELECT de desempate roda sempre que nada foi inserido —
 * idempotência de `/start` não pode virar falso-recusado só porque o Assinante já está no teto.
 *
 * Risco residual, deliberadamente não fechado aqui: isto protege contra a FALTA DE AFINIDADE DE
 * SESSÃO do `Pool` (o problema documentado acima), não contra duas invocações GENUINAMENTE
 * concorrentes para o MESMO assinante — sob READ COMMITTED, o `count(*)` de cada uma enxerga o
 * snapshot do início da própria instrução, então duas corridas em paralelo podem, cada uma, ver
 * `< 10` e inserir, superando o teto por uma margem pequena. Fechar isso de verdade exigiria
 * SERIALIZABLE (com retry no chamador) ou uma transação explícita numa conexão só — o que alargaria
 * `BotPool` para além do que este ticket pede. Risco aceito e sinalizado, não silencioso.
 */
export async function ensureSubscription(pool: BotPool, subscriberId: number, storeId: number): Promise<EnsureSubscriptionResult> {
  const inserted = await pool.query<unknown>(
    `insert into public.subscriptions (subscriber_id, store_id, mode)
     select $1, $2, 'improvement'
     where (select count(*) from public.subscriptions where subscriber_id = $1) < $3
     on conflict (subscriber_id, store_id) do nothing
     returning subscriber_id`,
    [subscriberId, storeId, SUBSCRIPTION_CAP],
  );
  if (inserted.rows.length > 0) return "created";

  const existing = await pool.query<unknown>(
    "select 1 from public.subscriptions where subscriber_id = $1 and store_id = $2",
    [subscriberId, storeId],
  );
  return existing.rows.length > 0 ? "exists" : "capped";
}

/** As duas grandezas de Reward (`packages/shared/src/reward.ts`) que o Piso pode tipar. */
export type RewardType = "percent" | "fixed";

export interface Subscription {
  slug: string;
  storeName: string;
  modeInfo: { mode: "improvement" } | { mode: "tracking"; floorValue: number; floorRewardType: RewardType };
}

// Espelha o CHECK `subscriptions_floor_matches_mode` do schema: melhoria nunca tem Piso, acompanhamento
// sempre tem. Modelar como união discriminada (em vez de campos opcionais soltos) torna "melhoria com
// Piso" um estado irrepresentável no TypeScript, não só proibido no banco.
const SubscriptionRow = z.discriminatedUnion("mode", [
  z.object({
    slug: z.string(),
    store_name: z.string(),
    mode: z.literal("improvement"),
    floor_value: z.null(),
    floor_reward_type: z.null(),
  }),
  z.object({
    slug: z.string(),
    store_name: z.string(),
    mode: z.literal("tracking"),
    floor_value: z.coerce.number(),
    floor_reward_type: z.enum(["percent", "fixed"]),
  }),
]);

/** `/lojas`: todas as Inscrições do Assinante, com o modo e o Piso (quando houver). */
export async function listSubscriptions(pool: BotPool, telegramChatId: number): Promise<Subscription[]> {
  const result = await pool.query<unknown>(
    `select st.slug, st.name as store_name, s.mode, s.floor_value, s.floor_reward_type
     from public.subscriptions s
     join public.subscribers sub on sub.id = s.subscriber_id
     join public.stores st on st.id = s.store_id
     where sub.telegram_chat_id = $1
     order by st.name`,
    [telegramChatId],
  );

  return result.rows.map((row) => {
    const parsed = SubscriptionRow.parse(row);
    return {
      slug: parsed.slug,
      storeName: parsed.store_name,
      modeInfo:
        parsed.mode === "improvement"
          ? { mode: "improvement" as const }
          : { mode: "tracking" as const, floorValue: parsed.floor_value, floorRewardType: parsed.floor_reward_type },
    };
  });
}

/**
 * `/parar <slug>` remove só a Inscrição daquela Loja canônica — nunca o Assinante. Junta por
 * `telegram_chat_id` em vez de resolver o `subscriber_id` numa ida separada: um chat sem nenhuma
 * Inscrição (nunca falou com o bot, ou já apagou tudo) não precisa de um caso especial, o `join`
 * simplesmente não casa nenhuma linha.
 */
export async function removeSubscription(pool: BotPool, telegramChatId: number, storeId: number): Promise<boolean> {
  const deleted = await pool.query<unknown>(
    `delete from public.subscriptions s
     using public.subscribers sub
     where s.subscriber_id = sub.id
       and sub.telegram_chat_id = $1
       and s.store_id = $2
     returning s.store_id`,
    [telegramChatId, storeId],
  );
  return deleted.rows.length > 0;
}

/**
 * `/parar` sem argumento é a única promessa de eliminação que a consentBlock faz (ADR-0066: "é
 * DELETE, não flag"). A FK de `subscriptions` para `subscribers` tem cascade (#113): uma linha
 * apaga as duas. Reusada por dois chamadores: `/parar` sem argumento e o update `my_chat_member`
 * com status `kicked` (bloqueio do bot, ADR-0066) — os dois querem exatamente a mesma eliminação
 * total e imediata, só a origem do `telegramChatId` muda.
 */
export async function deleteSubscriber(pool: BotPool, telegramChatId: number): Promise<boolean> {
  const deleted = await pool.query<unknown>("delete from public.subscribers where telegram_chat_id = $1 returning id", [telegramChatId]);
  return deleted.rows.length > 0;
}
