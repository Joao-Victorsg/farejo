import { describe, expect, it } from "vitest";
import { l2Key } from "./normalize.js";

describe("l2Key", () => {
  it("lowercases", () => {
    expect(l2Key("NIKE")).toBe("nike");
  });

  it("strips accents", () => {
    expect(l2Key("Óticas Carol")).toBe("oticascarol");
  });

  it("turns + into plus before stripping punctuation", () => {
    expect(l2Key("Disney+")).toBe("disneyplus");
  });

  it("turns & into e", () => {
    expect(l2Key("H&M")).toBe("hem");
  });

  it("strips a .com.br domain", () => {
    expect(l2Key("nike.com.br")).toBe("nike");
  });

  it("strips a .com domain", () => {
    expect(l2Key("nike.com")).toBe("nike");
  });

  it("strips a .br domain", () => {
    expect(l2Key("nike.br")).toBe("nike");
  });

  it("strips punctuation", () => {
    expect(l2Key("123 Milhas!")).toBe("123milhas");
  });

  it("joins tokens without spaces", () => {
    expect(l2Key("Fast Shop")).toBe("fastshop");
  });

  it("merges Fast Shop and Fastshop", () => {
    expect(l2Key("Fast Shop")).toBe(l2Key("Fastshop"));
  });

  it("merges 123 Milhas and 123milhas", () => {
    expect(l2Key("123 Milhas")).toBe(l2Key("123milhas"));
  });

  it("merges Casas Bahia and casasbahia.com.br", () => {
    expect(l2Key("Casas Bahia")).toBe(l2Key("casasbahia.com.br"));
  });

  it("does not merge Nike and Nike Store", () => {
    expect(l2Key("Nike")).not.toBe(l2Key("Nike Store"));
  });

  it("does not merge Disney+ and Disney Store", () => {
    expect(l2Key("Disney+")).not.toBe(l2Key("Disney Store"));
  });

  it("does not strip noise words like loja/store/br/oficial", () => {
    expect(l2Key("Nike Store")).toBe("nikestore");
    expect(l2Key("Loja Oficial Nike")).toBe("lojaoficialnike");
    expect(l2Key("Nike BR")).toBe("nikebr");
  });
});
