import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_COLUMNS = [
  "record_type",
  "clean_from",
  "day",
  "store_slug",
  "store_name",
  "platform_id",
  "platform_name",
  "activations",
] as const;
const GA4_REPORT_COLUMNS = ["period_start", "period_end", "metric", "active_users", "event_count", "store_slug", "platform_id"] as const;
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  cuponomia: "Cuponomia",
  inter: "Shopping Inter",
  meliuz: "Méliuz",
  mycashback: "MyCashback",
  zoom: "Zoom",
};

function isCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const DateValue = z.string().refine(isCalendarDate, "Use uma data válida no formato AAAA-MM-DD");
const NonNegativeInteger = z.coerce.number().int().nonnegative();

const CutoverRow = z.object({
  record_type: z.literal("cutover"),
  clean_from: DateValue,
});

const ActivationRow = z.object({
  record_type: z.literal("activation"),
  clean_from: DateValue,
  day: DateValue,
  store_slug: z.string().min(1),
  store_name: z.string().min(1),
  platform_id: z.string().min(1),
  platform_name: z.string().min(1),
  activations: NonNegativeInteger,
});

const SmokeRow = z.object({
  record_type: z.literal("smoke"),
  clean_from: DateValue,
  day: DateValue,
  activations: NonNegativeInteger,
});

const ExportRow = z.discriminatedUnion("record_type", [CutoverRow, ActivationRow, SmokeRow]);
export type PartnerReportExportRow = z.infer<typeof ExportRow>;

const Ga4Metric = z.enum(["site_access", "search", "search_results_view", "store_page_view", "activation_redirect"]);
const Ga4ExportRow = z.object({
  period_start: DateValue,
  period_end: DateValue,
  metric: Ga4Metric,
  active_users: NonNegativeInteger,
  event_count: NonNegativeInteger,
  store_slug: z.string(),
  platform_id: z.string(),
  result_bucket: z.enum(["", "0", "1", "2-5", "6+"]),
}).superRefine((row, context) => {
  if ((row.metric === "site_access" || row.metric === "search" || row.metric === "search_results_view") && (row.store_slug || row.platform_id)) {
    context.addIssue({ code: "custom", message: `${row.metric} não deve ter dimensão de loja/plataforma` });
  }
  if (row.metric === "search_results_view" ? !row.result_bucket : Boolean(row.result_bucket)) {
    context.addIssue({ code: "custom", message: "result_bucket é exclusivo e obrigatório em search_results_view" });
  }
  if (row.metric === "store_page_view" && row.platform_id) {
    context.addIssue({ code: "custom", message: "store_page_view deve ser agrupado apenas por loja" });
  }
  if (row.metric === "activation_redirect" && Boolean(row.store_slug) !== Boolean(row.platform_id)) {
    context.addIssue({ code: "custom", message: "activation_redirect deve ter loja e plataforma juntas" });
  }
});
export type PartnerGa4ExportRow = z.infer<typeof Ga4ExportRow>;

const ReportInput = z.object({
  since: DateValue,
  until: DateValue,
  vercel: z.object({ visitors: NonNegativeInteger, pageviews: NonNegativeInteger }),
  rows: z.array(ExportRow).min(1),
  ga4: z.object({ startedOn: DateValue, rows: z.array(Ga4ExportRow).min(1) }).optional(),
});

interface PartnerGa4Stage {
  activeUsers: number | null;
  events: number | null;
}

interface PartnerGa4StorePage {
  slug: string;
  pageUsers: number | null;
}

interface PartnerGa4StoreRedirect {
  slug: string;
  platformName: string;
  platformId: string;
  redirectUsers: number | null;
}

export interface PartnerReport {
  since: string;
  until: string;
  cleanFrom: string;
  visitors: number;
  pageviews: number;
  cleanRedirects: number;
  legacyRedirects: number;
  smokeRedirects: number;
  platforms: Array<{ id: string; name: string; redirects: number }>;
  stores: Array<{ slug: string; name: string; platformName: string; redirects: number }>;
  ga4: null | {
    startedOn: string;
    coverageStart: string;
    siteAccess: PartnerGa4Stage;
    searches: PartnerGa4Stage;
    searchResultsViews: null | { total: number; zero: number; zeroShare: number | null };
    storePageViews: PartnerGa4Stage;
    activationRedirects: PartnerGa4Stage;
    storePages: PartnerGa4StorePage[];
    storeRedirects: PartnerGa4StoreRedirect[];
  };
}

function parseCsvRecords(csv: string): string[][] {
  const source = csv.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) continue;

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV inválido: campo entre aspas não foi fechado");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.length > 0)) records.push(record);
  }
  return records;
}

export function parseActivationMetricsCsv(csv: string): PartnerReportExportRow[] {
  const [header, ...records] = parseCsvRecords(csv);
  if (!header) throw new Error("CSV de ativações vazio");
  if (new Set(header).size !== header.length || REPORT_COLUMNS.some((column) => !header.includes(column))) {
    throw new Error(`CSV de ativações precisa conter as colunas: ${REPORT_COLUMNS.join(", ")}`);
  }

  const indexByColumn = new Map(header.map((column, index) => [column, index]));
  return records.map((record, rowIndex) => {
    if (record.length !== header.length) throw new Error(`CSV inválido na linha ${rowIndex + 2}: quantidade de colunas incorreta`);
    const values = Object.fromEntries(REPORT_COLUMNS.map((column) => [column, record[indexByColumn.get(column) ?? -1] ?? ""]));
    const parsed = ExportRow.safeParse(values);
    if (!parsed.success) throw new Error(`CSV inválido na linha ${rowIndex + 2}: ${parsed.error.issues[0]?.message ?? "linha não reconhecida"}`);
    return parsed.data;
  });
}

export function parseGa4PartnerMetricsCsv(csv: string): PartnerGa4ExportRow[] {
  const [header, ...records] = parseCsvRecords(csv);
  if (!header) throw new Error("CSV agregado do GA4 vazio");
  if (new Set(header).size !== header.length || GA4_REPORT_COLUMNS.some((column) => !header.includes(column))) {
    throw new Error(`CSV agregado do GA4 precisa conter as colunas: ${GA4_REPORT_COLUMNS.join(", ")}`);
  }

  const indexByColumn = new Map(header.map((column, index) => [column, index]));
  return records.map((record, rowIndex) => {
    if (record.length !== header.length) throw new Error(`CSV GA4 inválido na linha ${rowIndex + 2}: quantidade de colunas incorreta`);
    const values = Object.fromEntries(GA4_REPORT_COLUMNS.map((column) => [column, record[indexByColumn.get(column) ?? -1] ?? ""]));
    values.result_bucket = record[indexByColumn.get("result_bucket") ?? -1] ?? "";
    const parsed = Ga4ExportRow.safeParse(values);
    if (!parsed.success) throw new Error(`CSV GA4 inválido na linha ${rowIndex + 2}: ${parsed.error.issues[0]?.message ?? "linha não reconhecida"}`);
    if (parsed.data.period_start > parsed.data.period_end) throw new Error(`CSV GA4 inválido na linha ${rowIndex + 2}: período invertido`);
    return parsed.data;
  });
}

function inRange(day: string, since: string, until: string) {
  return day >= since && day <= until;
}

function sortByRedirects<T extends { name: string; redirects: number }>(rows: T[]) {
  return rows.sort((left, right) => right.redirects - left.redirects || left.name.localeCompare(right.name, "pt-BR"));
}

export function buildPartnerReport(input: z.input<typeof ReportInput>): PartnerReport {
  const parsed = ReportInput.parse(input);
  if (parsed.since > parsed.until) throw new Error("A data inicial (since) precisa ser anterior ou igual à data final (until)");

  const cutovers = parsed.rows.filter((row) => row.record_type === "cutover").map((row) => row.clean_from);
  const cleanFrom = cutovers[0];
  if (!cleanFrom || cutovers.some((date) => date !== cleanFrom)) throw new Error("Exportação precisa conter exatamente uma data de corte consistente");

  const platformTotals = new Map<string, { id: string; name: string; redirects: number }>();
  const storeTotals = new Map<string, { slug: string; name: string; platformName: string; redirects: number }>();
  let cleanRedirects = 0;
  let legacyRedirects = 0;
  let smokeRedirects = 0;

  for (const row of parsed.rows) {
    if (row.record_type === "cutover" || !inRange(row.day, parsed.since, parsed.until)) continue;
    if (row.record_type === "smoke") {
      smokeRedirects += row.activations;
      continue;
    }
    if (row.day < cleanFrom) {
      legacyRedirects += row.activations;
      continue;
    }

    cleanRedirects += row.activations;
    const platform = platformTotals.get(row.platform_id) ?? { id: row.platform_id, name: row.platform_name, redirects: 0 };
    platform.redirects += row.activations;
    platformTotals.set(row.platform_id, platform);

    const key = `${row.store_slug}\u0000${row.platform_id}`;
    const store = storeTotals.get(key) ?? {
      slug: row.store_slug,
      name: row.store_name,
      platformName: row.platform_name,
      redirects: 0,
    };
    store.redirects += row.activations;
    storeTotals.set(key, store);
  }

  let ga4: PartnerReport["ga4"] = null;
  if (parsed.ga4) {
    const { startedOn, rows: ga4Rows } = parsed.ga4;
    if (startedOn > parsed.until) throw new Error("A data de início da coleta GA4 não pode ser posterior ao fim do relatório");
    if (ga4Rows.some((row) => row.period_start !== parsed.since || row.period_end !== parsed.until)) {
      throw new Error("Todas as linhas do CSV GA4 precisam usar exatamente o período do relatório");
    }
    const ga4Keys = new Set<string>();
    for (const row of ga4Rows) {
      const key = `${row.metric}\u0000${row.store_slug}\u0000${row.platform_id}\u0000${row.result_bucket}`;
      if (ga4Keys.has(key)) throw new Error(`CSV GA4 contém linha repetida para ${row.metric}`);
      ga4Keys.add(key);
    }
    const totalFor = (metric: PartnerGa4ExportRow["metric"]): PartnerGa4Stage => {
      const matching = ga4Rows.filter((row) => row.metric === metric && !row.store_slug && !row.platform_id);
      if (matching.length > 1) throw new Error(`CSV GA4 contém mais de uma linha total para ${metric}`);
      const row = matching[0];
      return row ? { activeUsers: row.active_users, events: row.event_count } : { activeUsers: null, events: null };
    };
    const storePages = ga4Rows
      .filter((row) => row.metric === "store_page_view" && row.store_slug)
      .map((row) => ({ slug: row.store_slug, pageUsers: row.active_users }))
      .sort((left, right) => (right.pageUsers ?? 0) - (left.pageUsers ?? 0) || left.slug.localeCompare(right.slug, "pt-BR"));
    const resultRows = ga4Rows.filter((row) => row.metric === "search_results_view");
    const resultTotal = resultRows.reduce((total, row) => total + row.event_count, 0);
    const zeroResults = resultRows.find((row) => row.result_bucket === "0")?.event_count ?? 0;
    const storeRedirects = ga4Rows
      .filter((row) => row.metric === "activation_redirect" && row.store_slug && row.platform_id)
      .map((matchingRow) => {
        const { store_slug: slug, platform_id: platformId } = matchingRow;
        const catalogStore = storeTotals.get(`${slug}\u0000${platformId}`);
        return {
          slug,
          platformName: catalogStore?.platformName ?? PLATFORM_NAMES[platformId] ?? (platformId || "—"),
          platformId,
          redirectUsers: matchingRow.active_users,
        };
      })
      .sort((left, right) => (right.redirectUsers ?? 0) - (left.redirectUsers ?? 0) || left.slug.localeCompare(right.slug, "pt-BR"));
    ga4 = {
      startedOn,
      coverageStart: parsed.since > startedOn ? parsed.since : startedOn,
      siteAccess: totalFor("site_access"),
      searches: totalFor("search"),
      searchResultsViews: resultRows.length === 0 ? null : { total: resultTotal, zero: zeroResults, zeroShare: resultTotal === 0 ? null : (zeroResults / resultTotal) * 100 },
      storePageViews: totalFor("store_page_view"),
      activationRedirects: totalFor("activation_redirect"),
      storePages,
      storeRedirects,
    };
  }

  return {
    since: parsed.since,
    until: parsed.until,
    cleanFrom,
    visitors: parsed.vercel.visitors,
    pageviews: parsed.vercel.pageviews,
    cleanRedirects,
    legacyRedirects,
    smokeRedirects,
    platforms: sortByRedirects([...platformTotals.values()]),
    stores: [...storeTotals.values()].sort((left, right) =>
      right.redirects - left.redirects || left.name.localeCompare(right.name, "pt-BR") || left.platformName.localeCompare(right.platformName, "pt-BR")),
    ga4,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatOptionalNumber(value: number | null) {
  return value === null ? "—" : formatNumber(value);
}

export function renderPartnerReportHtml(report: PartnerReport): string {
  const platformRows = report.platforms.length > 0
    ? report.platforms.map((platform) => `<tr><td>${escapeHtml(platform.name)}</td><td>${formatNumber(platform.redirects)}</td></tr>`).join("")
    : `<tr><td colspan="2">Nenhum redirect elegível no período.</td></tr>`;
  const storeRows = report.stores.length > 0
    ? report.stores.map((store) => `<tr><td>${escapeHtml(store.name)}</td><td>${escapeHtml(store.platformName)}</td><td>${formatNumber(store.redirects)}</td></tr>`).join("")
    : `<tr><td colspan="3">Nenhum redirect elegível no período.</td></tr>`;
  const ga4StorePageRows = report.ga4?.storePages.length
    ? report.ga4.storePages.map((store) => `<tr><td>${escapeHtml(store.slug)}</td><td>${formatOptionalNumber(store.pageUsers)}</td></tr>`).join("")
    : `<tr><td colspan="2">Não há detalhamento GA4 de páginas de loja neste CSV.</td></tr>`;
  const ga4StoreRedirectRows = report.ga4?.storeRedirects.length
    ? report.ga4.storeRedirects.map((store) => `<tr><td>${escapeHtml(store.slug)}</td><td>${escapeHtml(store.platformName)}</td><td>${formatOptionalNumber(store.redirectUsers)}</td></tr>`).join("")
    : `<tr><td colspan="3">Não há detalhamento GA4 de redirects por loja/plataforma neste CSV.</td></tr>`;
  const includesLegacy = report.since < report.cleanFrom;
  const includesPreGa4 = report.ga4 !== null && report.since < report.ga4.startedOn;
  const ga4SearchResultSummary = report.ga4?.searchResultsViews
    ? `<h2>Resultados de busca vistos</h2><div class="cards"><article class="card"><div class="label">Visualizações de resultados</div><div class="value">${formatNumber(report.ga4.searchResultsViews.total)}</div><div class="subtle">GA4 com consentimento; não são buscas únicas</div></article><article class="card"><div class="label">Sem resultado</div><div class="value">${formatNumber(report.ga4.searchResultsViews.zero)}</div><div class="subtle">${report.ga4.searchResultsViews.zeroShare === null ? "—" : `${report.ga4.searchResultsViews.zeroShare.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} das visualizações de resultados medidas</div></article></div>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de alcance e ativações — farejô</title>
<style>
:root{color-scheme:light;--ink:#18231d;--muted:#5b675f;--line:#dfe7e1;--green:#176b43;--paper:#f5f8f5}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:960px;margin:0 auto;padding:48px 24px 64px}header{border-bottom:1px solid var(--line);padding-bottom:24px}h1{font-size:clamp(28px,4vw,42px);line-height:1.1;margin:0 0 12px}h2{font-size:21px;margin:36px 0 12px}p{color:var(--muted);margin:8px 0}.eyebrow{color:var(--green);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:24px 0}.card{background:white;border:1px solid var(--line);border-radius:14px;padding:20px}.label{color:var(--muted);font-size:13px}.value{font-size:32px;font-weight:750;line-height:1.15;margin-top:8px}.subtle{font-size:13px;color:var(--muted)}table{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line)}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}td:last-child,th:last-child{text-align:right}tbody tr:last-child td{border-bottom:0}.note{border-left:4px solid var(--green);background:#eaf3ed;padding:14px 16px;border-radius:0 10px 10px 0}.warning{border-left-color:#b26a00;background:#fff5df}.foot{border-top:1px solid var(--line);margin-top:36px;padding-top:18px;font-size:13px}@media print{body{background:white}main{padding:18px;max-width:none}.card,table{break-inside:avoid}}
</style></head><body><main>
<header><div class="eyebrow">farejô · relatório para parcerias</div><h1>Alcance e redirecionamentos</h1><p>Período de ${formatDate(report.since)} a ${formatDate(report.until)}</p></header>
<section class="cards" aria-label="Resumo do período">
<article class="card"><div class="label">Visitantes estimados</div><div class="value">${formatNumber(report.visitors)}</div><div class="subtle">Vercel Analytics</div></article>
<article class="card"><div class="label">Visualizações de página</div><div class="value">${formatNumber(report.pageviews)}</div><div class="subtle">Vercel Analytics</div></article>
<article class="card"><div class="label">Redirecionamentos validados</div><div class="value">${formatNumber(report.cleanRedirects)}</div><div class="subtle">Offers encaminhadas após validação</div></article>
</section>
<div class="note"><strong>Como ler os números:</strong> visitantes são uma estimativa agregada do Vercel. Um redirect validado indica que o farejô encaminhou uma oferta vigente para a plataforma; não identifica uma pessoa única e não representa compra nem cashback recebido.</div>
${includesLegacy ? `<div class="note warning" style="margin-top:12px"><strong>Série histórica:</strong> ${formatNumber(report.legacyRedirects)} redirects são anteriores a ${formatDate(report.cleanFrom)} e ainda incluem os testes automáticos de publicação. Eles aparecem separados e não entram no total comercial acima.</div>` : ""}
${report.ga4 ? `<h2>Jornada no GA4 (somente quem aceitou analytics)</h2><p>Período coberto pelo GA4: ${formatDate(report.ga4.coverageStart)} a ${formatDate(report.until)}.</p><div class="cards" aria-label="Etapas medidas pelo GA4"><article class="card"><div class="label">Usuários ativos no site</div><div class="value">${formatOptionalNumber(report.ga4.siteAccess.activeUsers)}</div><div class="subtle">${formatOptionalNumber(report.ga4.siteAccess.events)} visualizações de página</div></article><article class="card"><div class="label">Usuários que pesquisaram</div><div class="value">${formatOptionalNumber(report.ga4.searches.activeUsers)}</div><div class="subtle">${formatOptionalNumber(report.ga4.searches.events)} buscas, sem termos coletados</div></article><article class="card"><div class="label">Usuários que abriram página de loja</div><div class="value">${formatOptionalNumber(report.ga4.storePageViews.activeUsers)}</div><div class="subtle">Pageviews: ${formatOptionalNumber(report.ga4.storePageViews.events)}</div></article><article class="card"><div class="label">Usuários com redirect 307</div><div class="value">${formatOptionalNumber(report.ga4.activationRedirects.activeUsers)}</div><div class="subtle">${formatOptionalNumber(report.ga4.activationRedirects.events)} eventos confirmados pelo Farejo</div></article></div>${ga4SearchResultSummary}<div class="note">Os usuários do GA4 são estimativas pseudônimas e incluem apenas sessões com consentimento. A etapa final significa que o Farejo validou a oferta e emitiu um 307; não confirma abertura da plataforma ou compra.</div>${includesPreGa4 ? `<div class="note warning" style="margin-top:12px"><strong>Cobertura do GA4:</strong> a coleta começou em ${formatDate(report.ga4.startedOn)}. Os números acima cobrem somente ${formatDate(report.ga4.coverageStart)} a ${formatDate(report.until)}; não foram preenchidos retroativamente.</div>` : ""}<h2>Usuários GA4 por página de loja</h2><table><thead><tr><th>Loja</th><th>Usuários na página</th></tr></thead><tbody>${ga4StorePageRows}</tbody></table><h2>Usuários GA4 com redirect por loja e plataforma</h2><table><thead><tr><th>Loja</th><th>Plataforma</th><th>Usuários com 307</th></tr></thead><tbody>${ga4StoreRedirectRows}</tbody></table>` : `<h2>Funil GA4</h2><div class="note">Nenhum CSV agregado do GA4 foi fornecido. As métricas do GA4 ficam indisponíveis; não são tratadas como zero.</div>`}
<h2>Redirecionamentos por plataforma</h2><table><thead><tr><th>Plataforma</th><th>Redirects</th></tr></thead><tbody>${platformRows}</tbody></table>
<h2>Redirecionamentos por loja</h2><table><thead><tr><th>Loja</th><th>Plataforma</th><th>Redirects</th></tr></thead><tbody>${storeRows}</tbody></table>
<p class="subtle" style="margin-top:12px">${formatNumber(report.smokeRedirects)} redirects automáticos de smoke foram identificados e excluídos do total por plataforma e loja.</p>
<footer class="foot"><p><strong>Fontes:</strong> Vercel Web Analytics${report.ga4 ? ", exportação agregada do GA4" : ""} e agregados diários de ativações do Supabase.</p><p>O Farejo não inclui eventos individuais nem copia identificadores do Google para o relatório. GA4 cobre somente quem aceitou analytics; Vercel estima alcance agregado de forma independente.</p></footer>
</main></body></html>`;
}
