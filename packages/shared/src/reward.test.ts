import { describe, expect, it } from "vitest";
import { ParseError, parseReward } from "./reward.js";

describe("parseReward", () => {
  it("parses a plain percent", () => {
    expect(parseReward("7% Cashback")).toEqual({ type: "percent", value: 7, isUpto: false });
  });

  it("parses an up-to percent", () => {
    expect(parseReward("Até 11% Cashback")).toEqual({
      type: "percent",
      value: 11,
      isUpto: true,
    });
  });

  it("parses a lowercase up-to percent", () => {
    expect(parseReward("até 3%")).toEqual({ type: "percent", value: 3, isUpto: true });
  });

  it("parses an up-to percent with a footnote asterisk", () => {
    expect(parseReward("Até* 20%")).toEqual({ type: "percent", value: 20, isUpto: true });
  });

  it("parses a dot-decimal percent", () => {
    expect(parseReward("3.5%")).toEqual({ type: "percent", value: 3.5, isUpto: false });
  });

  it("parses a comma-decimal percent", () => {
    expect(parseReward("4,5%")).toEqual({ type: "percent", value: 4.5, isUpto: false });
  });

  it("parses a percent with a trailing qualifier", () => {
    expect(parseReward("12% de cashback")).toEqual({ type: "percent", value: 12, isUpto: false });
  });

  it("parses a sub-1% dot-decimal reward", () => {
    expect(parseReward("0.5% de volta")).toEqual({ type: "percent", value: 0.5, isUpto: false });
  });

  it("parses a percent embedded in a full sentence", () => {
    expect(parseReward("Zoom te devolve 0.5% do valor")).toEqual({
      type: "percent",
      value: 0.5,
      isUpto: false,
    });
  });

  it("parses a fixed BRL reward", () => {
    expect(parseReward("R$ 8,5 de cashback")).toEqual({
      type: "fixed",
      value: 8.5,
      currency: "BRL",
    });
  });

  it("throws ParseError for unrecognized text", () => {
    expect(() => parseReward("Ofertas disponíveis")).toThrow(ParseError);
  });

  it("detects up-to right after the accented word boundary (méliuz hero button text)", () => {
    // \b falha depois de "é" sem stripAccents — "Ativar até 10%" viraria isUpto:false.
    expect(parseReward("Ativar até 10% de cashback")).toEqual({
      type: "percent",
      value: 10,
      isUpto: true,
    });
  });
});
