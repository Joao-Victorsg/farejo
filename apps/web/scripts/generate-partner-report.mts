import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { buildPartnerReport, parseActivationMetricsCsv, renderPartnerReportHtml } from "../src/lib/partner-report.js";

const Environment = z.object({
  VERCEL_TOKEN: z.string().min(1),
  VERCEL_TEAM_ID: z.string().min(1),
  VERCEL_PROJECT_ID: z.string().min(1),
});

const AnalyticsResponse = z.object({
  data: z.object({
    visitors: z.number().int().nonnegative(),
    pageviews: z.number().int().nonnegative(),
  }),
});

interface ReportArguments {
  since: string;
  until: string;
  redirects: string;
  output: string;
}

function parseArguments(argv: string[]): ReportArguments | null {
  if (argv.includes("--help") || argv.includes("-h")) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Argumentos inválidos perto de ${key ?? "fim"}. Use --help para ver o formato.`);
    }
    if (values.has(key)) throw new Error(`Argumento repetido: ${key}`);
    values.set(key, value);
    index += 1;
  }

  const since = values.get("--since");
  const until = values.get("--until");
  const redirects = values.get("--redirects");
  if (!since || !until || !redirects) throw new Error("Informe --since, --until e --redirects. Use --help para ver o formato.");
  const unexpected = [...values.keys()].filter((key) => !["--since", "--until", "--redirects", "--out"].includes(key));
  if (unexpected.length > 0) throw new Error(`Argumento desconhecido: ${unexpected[0]}`);

  return {
    since,
    until,
    redirects,
    output: values.get("--out") ?? `reports/partner-reports/farejo-${since}-${until}.html`,
  };
}

async function fetchVercelAnalytics(since: string, until: string) {
  const environment = Environment.parse(process.env);
  const url = new URL("https://api.vercel.com/v1/query/web-analytics/visits/count");
  url.searchParams.set("projectId", environment.VERCEL_PROJECT_ID);
  url.searchParams.set("teamId", environment.VERCEL_TEAM_ID);
  url.searchParams.set("since", since);
  url.searchParams.set("until", until);

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${environment.VERCEL_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Vercel Web Analytics respondeu HTTP ${response.status}. Confirme a coleta de produção e as permissões do token.`);
  }

  const parsed = AnalyticsResponse.safeParse(await response.json());
  if (!parsed.success) throw new Error("A resposta do Vercel Analytics não contém visitantes e pageviews agregados válidos.");
  return parsed.data.data;
}

function helpText() {
  return [
    "Gera um relatório HTML local a partir do Vercel Web Analytics e de um CSV do Supabase.",
    "",
    "Uso: pnpm --filter @farejo/web report:partners -- --since AAAA-MM-DD --until AAAA-MM-DD --redirects caminho.csv [--out caminho.html]",
    "",
    "Variáveis necessárias: VERCEL_TOKEN, VERCEL_TEAM_ID e VERCEL_PROJECT_ID.",
    "O CSV deve vir da consulta apps/web/scripts/partner-report-export.sql.",
  ].join("\n");
}

export async function generatePartnerReport(argv: string[]) {
  const args = parseArguments(argv);
  if (!args) return helpText();

  const [csv, vercel] = await Promise.all([
    readFile(resolve(args.redirects), "utf8"),
    fetchVercelAnalytics(args.since, args.until),
  ]);
  const rows = parseActivationMetricsCsv(csv);
  const report = buildPartnerReport({ since: args.since, until: args.until, vercel, rows });
  const html = renderPartnerReportHtml(report);
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  return `Relatório salvo em ${output}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${await generatePartnerReport(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Falha ao gerar o relatório."}\n`);
    process.exitCode = 1;
  }
}
