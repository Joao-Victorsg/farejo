import { describe, expect, it } from "vitest";
import {
  buildPartnerReport,
  parseActivationMetricsCsv,
  parseGa4PartnerMetricsCsv,
  renderPartnerReportHtml,
} from "../src/lib/partner-report.js";

const exportCsv = [
  "record_type,clean_from,day,store_slug,store_name,platform_id,platform_name,activations",
  "cutover,2026-09-20,,,,,,",
  "activation,2026-09-20,2026-09-19,nike,Nike,inter,Shopping Inter,10",
  "activation,2026-09-20,2026-09-20,nike,Nike,inter,Shopping Inter,7",
  "activation,2026-09-20,2026-09-21,loja-x,<script>alert(1)</script>,zoom,Zoom,4",
  "smoke,2026-09-20,2026-09-20,,,,,5",
].join("\n");
const ga4ExportCsv = [
  "period_start,period_end,metric,active_users,event_count,store_slug,platform_id,result_bucket",
  "2026-09-19,2026-09-21,site_access,80,115,,,",
  "2026-09-19,2026-09-21,search,32,44,,,",
  "2026-09-19,2026-09-21,search_results_view,5,8,,,0",
  "2026-09-19,2026-09-21,search_results_view,10,12,,,2-5",
  "2026-09-19,2026-09-21,store_page_view,27,52,,,",
  "2026-09-19,2026-09-21,store_page_view,12,17,nike,,",
  "2026-09-19,2026-09-21,store_page_view,4,5,petlove,,",
  "2026-09-19,2026-09-21,activation_redirect,9,11,,,",
  "2026-09-19,2026-09-21,activation_redirect,6,7,nike,inter,",
].join("\n");

describe("partner report", () => {
  it("separates clean redirects from legacy totals and excludes production smoke", () => {
    const rows = parseActivationMetricsCsv(exportCsv);
    const report = buildPartnerReport({
      since: "2026-09-19",
      until: "2026-09-20",
      vercel: { visitors: 100, pageviews: 180 },
      rows,
    });

    expect(report).toMatchObject({
      visitors: 100,
      pageviews: 180,
      cleanRedirects: 7,
      legacyRedirects: 10,
      smokeRedirects: 5,
      cleanFrom: "2026-09-20",
      platforms: [{ id: "inter", name: "Shopping Inter", redirects: 7 }],
      stores: [{ slug: "nike", name: "Nike", platformName: "Shopping Inter", redirects: 7 }],
    });
  });

  it("rejects a date range in reverse order and malformed exported rows", () => {
    const rows = parseActivationMetricsCsv(exportCsv);
    expect(() => buildPartnerReport({
      since: "2026-09-21",
      until: "2026-09-19",
      vercel: { visitors: 1, pageviews: 1 },
      rows,
    })).toThrow(/since.*until/i);
    expect(() => parseActivationMetricsCsv("record_type,clean_from\nunknown,2026-09-20")).toThrow();
  });

  it("renders a self-contained report with definitions and escaped store names", () => {
    const report = buildPartnerReport({
      since: "2026-09-19",
      until: "2026-09-21",
      vercel: { visitors: 100, pageviews: 180 },
      rows: parseActivationMetricsCsv(exportCsv),
    });
    const html = renderPartnerReportHtml(report);

    expect(html).toContain("Visitantes estimados");
    expect(html).toMatch(/S.rie hist.rica/);
    expect(html).toMatch(/10 redirects/);
    expect(html).toContain("eventos individuais");
    expect(html).toContain("Redirecionamentos validados");
    expect(html).toContain("não representa compra");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("https://");
    expect(html).toContain("Nenhum CSV agregado do GA4 foi fornecido");
  });

  it("combines aggregate GA4 stages without treating absent metrics as zero", () => {
    const report = buildPartnerReport({
      since: "2026-09-19",
      until: "2026-09-21",
      vercel: { visitors: 100, pageviews: 180 },
      rows: parseActivationMetricsCsv(exportCsv),
      ga4: { startedOn: "2026-09-20", rows: parseGa4PartnerMetricsCsv(ga4ExportCsv) },
    });
    const html = renderPartnerReportHtml(report);

    expect(report.ga4).toMatchObject({
      siteAccess: { activeUsers: 80, events: 115 },
      searches: { activeUsers: 32, events: 44 },
      searchResultsViews: { total: 20, zero: 8, zeroShare: 40 },
      storePageViews: { activeUsers: 27, events: 52 },
      activationRedirects: { activeUsers: 9, events: 11 },
    });
    expect(report.ga4?.coverageStart).toBe("2026-09-20");
    expect(report.ga4?.storePages).toContainEqual({ slug: "nike", pageUsers: 12 });
    expect(report.ga4?.storePages).toContainEqual({ slug: "petlove", pageUsers: 4 });
    expect(report.ga4?.storeRedirects).toContainEqual({ slug: "nike", platformName: "Shopping Inter", platformId: "inter", redirectUsers: 6 });
    expect(html).toContain("Jornada no GA4 (somente quem aceitou analytics)");
    expect(html).toContain("Resultados de busca vistos");
    expect(html).toContain("Período coberto pelo GA4: 20/09/2026 a 21/09/2026");
    expect(html).toContain("a coleta começou em 20/09/2026");
    expect(html).toContain("Usuários GA4 por página de loja");
    expect(html).toContain("Usuários GA4 com redirect por loja e plataforma");
    expect(html).toContain("exportação agregada do GA4");
    expect(html).not.toContain("client_id");
    expect(html).not.toContain("session_id");
  });

  it("rejects GA4 exports whose dates do not match the report", () => {
    expect(() => buildPartnerReport({
      since: "2026-09-20",
      until: "2026-09-21",
      vercel: { visitors: 1, pageviews: 1 },
      rows: parseActivationMetricsCsv(exportCsv),
      ga4: { startedOn: "2026-09-20", rows: parseGa4PartnerMetricsCsv(ga4ExportCsv) },
    })).toThrow(/período do relatório/i);
  });
});
