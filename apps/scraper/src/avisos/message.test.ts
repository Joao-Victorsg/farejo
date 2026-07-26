import { describe, expect, it } from "vitest";
import { buildAvisos, type PendingTransition } from "./message.js";

/**
 * F4/#114 — o corte no limite de 4096 caracteres do Bot API, testado aqui porque o seam de
 * integração não o alcança: seriam necessárias centenas de linhas de histórico para chegar lá por
 * fixture. E o caso importa: estourar o limite devolve HTTP 400, o MESMO status de "chat not
 * found", e o caminho de revogação apaga dado pessoal.
 */
function transition(storeName: string, value: number): PendingTransition {
  return {
    subscriberId: 1,
    telegramChatId: "42",
    storeName,
    platformName: "Méliuz",
    rewardType: "percent",
    value,
    isUpto: false,
    previousValue: value - 1,
    previousRewardType: "percent",
    previousIsUpto: false,
  };
}

describe("buildAvisos — limite do Telegram", () => {
  it("entrega a mensagem inteira quando ela cabe", () => {
    const [aviso] = buildAvisos([transition("Amazon", 5), transition("KaBuM", 7)]);
    expect(aviso!.text.length).toBeLessThanOrEqual(4096);
    expect(aviso!.text).toContain("Amazon");
    expect(aviso!.text).toContain("KaBuM");
    expect(aviso!.text).not.toContain("e mais");
  });

  it("corta em blocos inteiros e diz quantas lojas ficaram de fora", () => {
    const many = Array.from({ length: 400 }, (_, index) => transition(`Loja ${index} com nome bem comprido para encher`, index + 2));
    const [aviso] = buildAvisos(many);

    expect(aviso!.text.length).toBeLessThanOrEqual(4096);
    expect(aviso!.text).toMatch(/… e mais \d+ lojas com mudanças\.$/);
    // Corte por bloco: nenhuma loja aparece com o nome sem a linha da plataforma embaixo.
    const orphanStore = aviso!.text.split("\n\n").find((block) => block.includes("Loja ") && !block.includes("•"));
    expect(orphanStore).toBeUndefined();
  });

  it("concorda em singular quando sobra uma loja só", () => {
    const many = Array.from({ length: 400 }, (_, index) => transition(`Loja ${index} com nome bem comprido para encher`, index + 2));
    const [aviso] = buildAvisos(many);
    expect(aviso!.text).not.toContain("e mais 1 lojas");
  });
});
