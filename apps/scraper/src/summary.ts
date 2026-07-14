import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createClient, type RunScopeLabel } from "@farejo/shared";
import { z } from "zod";
import { resolveSupabaseCredentials } from "./localDb.js";
import type { SupabaseClient } from "./supabaseClient.js";

export interface SummaryJob {
  platformId: string;
  scope: RunScopeLabel;
  label: string;
}

export interface SummaryRun {
  platformId: string;
  scope: RunScopeLabel;
  status: "ok" | "suspicious" | "failed";
  offersFound: number | null;
  activeOffers: number | null;
  parseErrors: number | null;
  notes: string | null;
}

type WorkflowJobConclusion = "success" | "failure" | "cancelled" | "skipped";
type WorkflowJobResults = Record<string, { result?: WorkflowJobConclusion | null }>;

const SummaryNotes = z.object({
  tripped: z.string().optional(),
  error: z.string().optional(),
});

const WorkflowJobResults = z.record(z.string(), z.object({
  result: z.enum(["success", "failure", "cancelled", "skipped"]).nullable().optional(),
}));

const TelegramSuccessResponse = z.object({ ok: z.literal(true) });

export const SUMMARY_JOBS = [
  { platformId: "inter", scope: "full", label: "Inter" },
  { platformId: "zoom", scope: "full", label: "Zoom" },
  { platformId: "mycashback", scope: "full", label: "MyCashback" },
  { platformId: "cuponomia", scope: "active", label: "Cuponomia (active)" },
  { platformId: "cuponomia", scope: "tail", label: "Cuponomia (tail)" },
  { platformId: "meliuz", scope: "active", label: "Méliuz (active)" },
  { platformId: "meliuz", scope: "tail", label: "Méliuz (tail)" },
] satisfies readonly SummaryJob[];

export function formatSummaryMessage(
  jobs: readonly SummaryJob[],
  runs: readonly SummaryRun[],
  jobResults: WorkflowJobResults = {},
): string {
  return jobs.map((job) => formatRunLine(job, runs.find((run) => matchesJob(run, job)), jobResults)).join("\n");
}

function matchesJob(run: SummaryRun, job: SummaryJob): boolean {
  return run.platformId === job.platformId && run.scope === job.scope;
}

function formatRunLine(job: SummaryJob, run: SummaryRun | undefined, jobResults: WorkflowJobResults): string {
  if (!run) return formatMissingRun(job, jobResults[workflowJobId(job)]?.result);

  if (run.status === "ok") {
    return `✅ ${job.label} — ${formatCounts(run)}`;
  }

  const emoji = run.status === "suspicious" ? "⚠️" : "❌";
  return `${emoji} ${job.label} — ${run.status}: ${reasonFor(run)}`;
}

function workflowJobId(job: SummaryJob): string {
  return job.scope === "full" ? job.platformId : `${job.platformId}-${job.scope}`;
}

function formatMissingRun(job: SummaryJob, jobResult: WorkflowJobConclusion | null | undefined): string {
  if (jobResult === "failure") return `❌ ${job.label} — failed: sem scrape_run`;
  if (jobResult === "cancelled") return `❌ ${job.label} — cancelled: sem scrape_run`;
  if (jobResult === "success") return `⚠️ ${job.label} — suspicious: scrape_run ausente`;
  return `⏭️ ${job.label} — não executado`;
}

function formatCounts(run: SummaryRun): string {
  if (run.offersFound == null || run.activeOffers == null || run.parseErrors == null) {
    return "contagens indisponíveis";
  }
  return `${run.offersFound} encontradas, ${run.activeOffers} ativas, ${run.parseErrors} erros de parse`;
}

function reasonFor(run: SummaryRun): string {
  const notes = parseNotes(run.notes);
  const reason = run.status === "suspicious" ? notes?.tripped : notes?.error;
  return typeof reason === "string" && reason.trim() ? reason.trim().replace(/\s+/g, " ") : "motivo não informado";
}

function parseNotes(notes: string | null): Record<string, unknown> | null {
  if (!notes) return null;
  try {
    const parsed: unknown = JSON.parse(notes);
    const result = SummaryNotes.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function loadSummaryRuns(supabase: SupabaseClient, workflowStartedAt: string): Promise<SummaryRun[]> {
  const { data, error } = await supabase
    .from("scrape_runs")
    .select("platform_id, scope, status, offers_found, active_offers, parse_errors, notes")
    .gte("started_at", workflowStartedAt)
    .order("started_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).flatMap((row): SummaryRun[] => {
    if (row.platform_id == null || !isSummaryStatus(row.status) || !isRunScopeLabel(row.scope)) return [];
    return [{
      platformId: row.platform_id,
      scope: row.scope,
      status: row.status,
      offersFound: row.offers_found,
      activeOffers: row.active_offers,
      parseErrors: row.parse_errors,
      notes: row.notes,
    }];
  });
}

function isSummaryStatus(status: string): status is SummaryRun["status"] {
  return status === "ok" || status === "suspicious" || status === "failed";
}

function isRunScopeLabel(scope: string): scope is RunScopeLabel {
  return scope === "full" || scope === "bootstrap" || scope === "active" || scope === "tail";
}

export interface TelegramMessage {
  token: string;
  chatId: string;
  text: string;
  fetch?: typeof globalThis.fetch;
}

/** O Telegram é observabilidade auxiliar: toda falha aqui vira aviso e nunca relança. */
export async function sendTelegramMessage({ token, chatId, text, fetch = globalThis.fetch }: TelegramMessage): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`[summary] Telegram respondeu HTTP ${response.status}`);
      return false;
    }

    const payload = TelegramSuccessResponse.safeParse(await response.json());
    if (!payload.success) {
      console.warn("[summary] Telegram recusou a mensagem");
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[summary] Falha ao enviar Telegram: ${errorMessage(error)}`);
    return false;
  }
}

const SummaryEnvironment = z.object({
  WORKFLOW_STARTED_AT: z.string().datetime({ offset: true }),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  JOB_RESULTS_JSON: z.string().min(1),
});

async function main(): Promise<void> {
  const environment = SummaryEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.warn("[summary] Variáveis de ambiente inválidas ou ausentes; resumo não enviado");
    return;
  }

  try {
    const { url, key } = resolveSupabaseCredentials();
    const runs = await loadSummaryRuns(createClient(url, key), environment.data.WORKFLOW_STARTED_AT);
    const text = formatSummaryMessage(SUMMARY_JOBS, runs, parseWorkflowJobResults(environment.data.JOB_RESULTS_JSON));
    await sendTelegramMessage({
      token: environment.data.TELEGRAM_BOT_TOKEN,
      chatId: environment.data.TELEGRAM_CHAT_ID,
      text,
    });
  } catch (error) {
    console.warn(`[summary] Falha ao montar resumo: ${errorMessage(error)}`);
  }
}

function parseWorkflowJobResults(value: string): WorkflowJobResults {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = WorkflowJobResults.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // A falha abaixo registra o mesmo aviso para JSON inválido e schema inesperado.
  }
  console.warn("[summary] JOB_RESULTS_JSON inválido; jobs sem run serão marcados como não executados");
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
