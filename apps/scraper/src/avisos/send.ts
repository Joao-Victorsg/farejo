import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createPostgresPool } from "@farejo/postgres";
import { z } from "zod";
import { buildAvisos, type PendingTransition } from "./message.js";
import { createTelegramTransport, type AvisoTransport, type TransportOutcome } from "./telegram.js";

export type { AvisoTransport, TransportOutcome };

/**
 * F4/#114 (ADR-0063/ADR-0064) — job de Avisos, encadeado a um scrape bem-sucedido (#119).
 *
 * Vive em `apps/scraper` pelo mesmo motivo do ingestor de logos: é uma Action pós-scrape, e aqui
 * já existem pool, dotenv e o caminho de Telegram. Roda sob `farejo_notifier`, que lê o que o
 * Aviso precisa e cuja única escrita é o cursor.
 */
export interface NotifierPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface AvisoRunReport {
  /** `null` quando não há histórico nenhum — nada a fazer. */
  watermark: string | null;
  avisosSent: number;
  sendFailures: number;
  subscribersRemoved: number;
  /** Assinantes sem nada a receber cujo cursor foi adiantado assim mesmo. */
  subscribersAdvanced: number;
}

/**
 * A linha vinda do SQL é dado externo como qualquer outro: valida com zod ANTES de virar tipo de
 * domínio, e o tipo deriva do schema. Isso é o que impede um `reward_type` inesperado de ser
 * renderizado como percentual em silêncio — a mistura de `%` com `R$` que o domínio proíbe.
 *
 * Campos que a função devolve e ninguém usa (slug da loja, id da plataforma, id do histórico)
 * ficam de fora: o zod os descarta, e não há tipo carregando o que não é lido.
 */
const PendingRow = z.object({
  subscriber_id: z.coerce.number().int().positive(),
  telegram_chat_id: z.coerce.string(),
  store_name: z.string(),
  platform_name: z.string(),
  reward_type: z.enum(["percent", "fixed"]),
  value: z.number(),
  is_upto: z.boolean(),
  previous_value: z.number().nullable(),
  previous_reward_type: z.enum(["percent", "fixed"]).nullable(),
  previous_is_upto: z.boolean().nullable(),
});

function toTransition(row: z.infer<typeof PendingRow>): PendingTransition {
  return {
    subscriberId: row.subscriber_id,
    telegramChatId: row.telegram_chat_id,
    storeName: row.store_name,
    platformName: row.platform_name,
    rewardType: row.reward_type,
    value: row.value,
    isUpto: row.is_upto,
    previousValue: row.previous_value,
    previousRewardType: row.previous_reward_type,
    previousIsUpto: row.previous_is_upto ?? false,
  };
}

/**
 * Um run completo: detecta, agrupa, envia e move o cursor.
 *
 * A marca d'água é capturada UMA vez, antes de tudo, e vale para todos os assinantes — assim o
 * cursor avança até um ponto único e conhecido, em vez de até "o que por acaso qualificou".
 *
 * ⚠️ PRÉ-CONDIÇÃO: nenhuma escrita de `offer_history` em voo. O id vem de uma sequence, e `nextval`
 * não é transacional — uma transação pode reservar o id 100, outra reservar o 101 e commitar
 * primeiro. Lendo `max(id)` nesse intervalo, o 100 nasce abaixo da marca d'água e é perdido para
 * SEMPRE, porque todos os cursores já passaram do ponto. Não existe watermark seguro enquanto
 * houver escritor concorrente: o problema é da sequence, não da consulta. Quem garante a
 * pré-condição é o workflow (`workflow_run` sobre um scrape concluído) — ver ADR-0063.
 */
export async function sendPendingAvisos(pool: NotifierPool, transport: AvisoTransport): Promise<AvisoRunReport> {
  const watermarkRows = await pool.query<{ watermark: string | null }>(
    "select max(id)::text as watermark from public.offer_history",
  );
  const watermark = watermarkRows.rows[0]?.watermark ?? null;
  if (watermark === null) {
    return { watermark: null, avisosSent: 0, sendFailures: 0, subscribersRemoved: 0, subscribersAdvanced: 0 };
  }

  const behind = await pool.query<{ id: string }>(
    "select id::text as id from public.subscribers where last_notified_history_id < $1",
    [watermark],
  );
  const pending = await pool.query<unknown>("select * from alerts.pending_avisos($1)", [watermark]);

  // Linha inválida é defeito de contrato nosso, não de site externo. Descarta a linha e segue: uma
  // linha estranha não pode impedir a entrega de todo o resto (mesmo princípio do erro por
  // assinante), mas some do relatório se ninguém contar — por isso o aviso e o número.
  const parsed = pending.rows.map((row) => PendingRow.safeParse(row));
  const invalidRows = parsed.filter((result) => !result.success).length;
  if (invalidRows > 0) console.warn(`[avisos] ${invalidRows} linha(s) de detecção fora do contrato foram descartadas`);

  const avisos = buildAvisos(parsed.flatMap((result) => (result.success ? [toTransition(result.data)] : [])));
  const withAviso = new Set(avisos.map((aviso) => aviso.subscriberId));

  let avisosSent = 0;
  let sendFailures = 0;
  let subscribersRemoved = 0;

  for (const aviso of avisos) {
    // Sequencial de propósito: o Telegram limita 1 mensagem/s por chat e 30/s no total, e um lote
    // grande em paralelo só encontraria o rate limit mais rápido.
    const outcome = await sendOne(pool, transport, aviso, watermark);
    if (outcome === "sent") avisosSent += 1;
    else if (outcome === "revoked") subscribersRemoved += 1;
    else sendFailures += 1;
  }

  // Quem não tinha nada a receber também avança: sem isso a janela de varredura desses assinantes
  // cresceria para sempre, e o custo da detecção junto.
  const quiet = behind.rows.map((row) => Number(row.id)).filter((id) => !withAviso.has(id));
  if (quiet.length > 0) {
    await pool.query("update public.subscribers set last_notified_history_id = $1 where id = any($2::bigint[])", [watermark, quiet]);
  }

  return { watermark, avisosSent, sendFailures, subscribersRemoved, subscribersAdvanced: quiet.length };
}

/**
 * Falha de um assinante nunca contamina os outros: o erro é contido aqui e vira `failed`, que
 * deixa o cursor parado e adia a entrega para o run seguinte.
 */
async function sendOne(
  pool: NotifierPool,
  transport: AvisoTransport,
  aviso: { subscriberId: number; chatId: string; text: string },
  watermark: string,
): Promise<TransportOutcome> {
  let outcome: TransportOutcome;
  try {
    outcome = await transport({ chatId: aviso.chatId, text: aviso.text });
  } catch (error) {
    console.warn(`[avisos] transporte lançou para um assinante: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }

  try {
    if (outcome === "sent") {
      await pool.query("update public.subscribers set last_notified_history_id = $1 where id = $2", [watermark, aviso.subscriberId]);
    } else if (outcome === "revoked") {
      // Revogação é definitiva (ADR-0066): apaga de verdade. As Inscrições vão junto por cascade.
      await pool.query("delete from public.subscribers where id = $1", [aviso.subscriberId]);
    }
  } catch (error) {
    console.warn(`[avisos] falha ao gravar o desfecho de um assinante: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }

  return outcome;
}

/** Diagnóstico por run: quantidade, nunca identidade (ADR-0066). */
export function formatAvisoRunReport(report: AvisoRunReport): string {
  if (report.watermark === null) return "[avisos] sem histórico de ofertas; nada a enviar";
  return `[avisos] ${report.avisosSent} enviados, ${report.sendFailures} falhas de envio, ${report.subscribersRemoved} assinantes removidos por revogação, ${report.subscribersAdvanced} sem novidade`;
}

const AvisosEnvironment = z.object({
  FAREJO_NOTIFIER_DATABASE_URL: z.string().min(1),
  FAREJO_AVISOS_BOT_TOKEN: z.string().min(1),
});

async function main(): Promise<void> {
  const environment = AvisosEnvironment.safeParse(process.env);
  if (!environment.success) {
    // Mesmo padrão do resumo de run e da cobertura de logos: credencial pendente de configuração
    // operacional é aviso, nunca quebra do pipeline.
    console.warn("[avisos] FAREJO_NOTIFIER_DATABASE_URL ou FAREJO_AVISOS_BOT_TOKEN ausente; envio pulado");
    return;
  }

  const pool = createPostgresPool(environment.data.FAREJO_NOTIFIER_DATABASE_URL, { max: 2 });
  try {
    const report = await sendPendingAvisos(pool, createTelegramTransport(environment.data.FAREJO_AVISOS_BOT_TOKEN));
    console.log(formatAvisoRunReport(report));
  } finally {
    await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
