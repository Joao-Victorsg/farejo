import { describe, expect, it } from "vitest";
import {
  buildPartnerReport,
  parseActivationMetricsCsv,
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
  });
});
