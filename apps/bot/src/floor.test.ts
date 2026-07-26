import { describe, expect, it } from "vitest";
import { floorMismatchHint, parseFloorValue, splitPisoArgument } from "./floor.js";

describe("parseFloorValue", () => {
  it.each([
    ["10", { rewardType: "percent", value: 10 }],
    ["10%", { rewardType: "percent", value: 10 }],
    ["10 %", { rewardType: "percent", value: 10 }],
    ["10,5", { rewardType: "percent", value: 10.5 }],
    ["10,5%", { rewardType: "percent", value: 10.5 }],
  ] as const)("aceita %s como piso percentual", (text, expected) => {
    expect(parseFloorValue(text)).toEqual(expected);
  });

  it.each([
    ["R$ 25", { rewardType: "fixed", value: 25 }],
    ["R$25", { rewardType: "fixed", value: 25 }],
    ["r$ 25", { rewardType: "fixed", value: 25 }],
    ["R$ 25,50", { rewardType: "fixed", value: 25.5 }],
    ["25 reais", { rewardType: "fixed", value: 25 }],
    ["25,50 reais", { rewardType: "fixed", value: 25.5 }],
  ] as const)("aceita %s como piso em reais", (text, expected) => {
    expect(parseFloorValue(text)).toEqual(expected);
  });

  it.each(["", "abc", "0", "-5", "10%%", "R$", "reais", "R$ -5", "0 reais", "% 10"])(
    "rejeita %s",
    (text) => {
      expect(parseFloorValue(text)).toBeNull();
    },
  );
});

describe("splitPisoArgument", () => {
  it("separa slug e valor quando o valor é um token só", () => {
    expect(splitPisoArgument("amazon 10%")).toEqual({ slug: "amazon", valueText: "10%" });
  });

  it("junta o valor de volta quando ele tem mais de um token (R$ 25, 25 reais)", () => {
    expect(splitPisoArgument("amazon R$ 25")).toEqual({ slug: "amazon", valueText: "R$ 25" });
    expect(splitPisoArgument("amazon 25 reais")).toEqual({ slug: "amazon", valueText: "25 reais" });
  });

  it("devolve null sem argumento nenhum", () => {
    expect(splitPisoArgument(undefined)).toBeNull();
  });

  it("devolve null quando só a loja veio, sem valor", () => {
    expect(splitPisoArgument("amazon")).toBeNull();
  });
});

describe("floorMismatchHint", () => {
  it("não sinaliza nada quando a grandeza do piso está entre as elegíveis", () => {
    expect(floorMismatchHint("percent", new Set(["percent", "fixed"]))).toEqual({ kind: "match" });
    expect(floorMismatchHint("fixed", new Set(["fixed"]))).toEqual({ kind: "match" });
  });

  it("sinaliza ausência de oferta elegível quando o conjunto está vazio", () => {
    expect(floorMismatchHint("percent", new Set())).toEqual({ kind: "no-eligible-offers" });
  });

  it("sugere a grandeza complementar quando existe oferta elegível, mas de outro tipo", () => {
    expect(floorMismatchHint("percent", new Set(["fixed"]))).toEqual({ kind: "mismatch", suggestedType: "fixed" });
    expect(floorMismatchHint("fixed", new Set(["percent"]))).toEqual({ kind: "mismatch", suggestedType: "percent" });
  });
});
