import { loadFixture } from "@farejo/test-fixtures";
import { describe, expect, it } from "vitest";
import { parseMycashback } from "./mycashback.js";

describe("parseMycashback", () => {
  const fixture = loadFixture("mycashback-all-shops.html");
  const result = parseMycashback(fixture);

  it("extracts 461 real offers out of 468 cards", () => {
    expect(result.offers).toHaveLength(461);
  });

  it("filters out the 7 fantasma cards ('Sem  Cashback', double space)", () => {
    const fantasmaNames = [
      "Estante Virtual",
      "Trivago",
      "Amazon.com.br",
      "Ortobom Colchões",
      "Homedock",
      "Mercado Livre",
      "Kopenhagen",
    ];
    for (const name of fantasmaNames) {
      expect(result.offers.find((o) => o.storeName === name)).toBeUndefined();
    }
  });

  it("uses the real logo from data-src, not the noimage.jpg lazyload placeholder", () => {
    const offer = result.offers.find((o) => o.storeName === "Temu");
    expect(offer?.logoUrl).toBe(
      "https://www.mycashback.com.br/tmp/uploads/retailers/temu_logo.svg/w250h80q80fit.png.webp",
    );
  });

  it("keeps the raw reward text as displayed", () => {
    const offer = result.offers.find((o) => o.storeName === "Temu");
    expect(offer?.rewardText).toBe("Até* 20% Cashback");
    expect(offer?.url).toBe("https://www.mycashback.com.br/retailer/temu");
  });

  it("normalizes a mangled href (repeated /home/ prefix seen live) to the real retailer URL", () => {
    const offer = result.offers.find((o) => o.storeName === "Ferreira Costa");
    expect(offer?.url).toBe("https://www.mycashback.com.br/retailer/ferreiracosta");
  });

  it("reports a full scope with no declared total (directory isn't authoritative)", () => {
    expect(result.scope).toEqual({ kind: "full" });
    expect(result.declaredTotal).toBeUndefined();
  });

  it("reports zero soft blocks", () => {
    expect(result.softBlocks).toBe(0);
  });

  it("counts every card received, before filtering fantasma offers", () => {
    expect(result.rawCount).toBe(468);
  });
});
