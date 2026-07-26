import { describe, expect, it } from "vitest";
import { createTelegramTransport } from "./telegram.js";

/**
 * F4/#114 — mapeamento status → desfecho, testado à parte do seam de integração porque é a única
 * camada onde ele existe, e porque a consequência de errar é severa: `revoked` apaga dado pessoal
 * de forma irreversível (ADR-0066). O seam do job não alcança isto — lá o transporte é falso.
 */
function fakeFetch(status: number, body: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch;
}

const message = { chatId: "42", text: "oi" };

describe("createTelegramTransport", () => {
  it("confirma o envio quando o Telegram aceita", async () => {
    const transport = createTelegramTransport("token", fakeFetch(200, { ok: true }));
    await expect(transport(message)).resolves.toBe("sent");
  });

  it("trata 403 como revogação — bloqueio é definitivo", async () => {
    const transport = createTelegramTransport("token", fakeFetch(403, { ok: false, description: "Forbidden: bot was blocked by the user" }));
    await expect(transport(message)).resolves.toBe("revoked");
  });

  it("trata 400 de chat inexistente como revogação", async () => {
    const transport = createTelegramTransport("token", fakeFetch(400, { ok: false, description: "Bad Request: chat not found" }));
    await expect(transport(message)).resolves.toBe("revoked");
  });

  /**
   * O caso que motivou a correção: o Bot API usa 400 para QUALQUER erro de cliente, e mensagem
   * acima de 4096 caracteres é um deles. Tratar todo 400 como revogação apagaria um assinante
   * ativo por causa do TAMANHO da própria mensagem — e um lote acumulado cresce.
   */
  it("NÃO trata 400 de mensagem longa como revogação", async () => {
    const transport = createTelegramTransport("token", fakeFetch(400, { ok: false, description: "Bad Request: message is too long" }));
    await expect(transport(message)).resolves.toBe("failed");
  });

  it("NÃO revoga em 400 sem descrição — revogação exige sinal definitivo", async () => {
    const transport = createTelegramTransport("token", fakeFetch(400, { ok: false }));
    await expect(transport(message)).resolves.toBe("failed");
  });

  it("trata 429 e 500 como falha temporária", async () => {
    for (const status of [429, 500, 502]) {
      const transport = createTelegramTransport("token", fakeFetch(status, { ok: false, description: "Too Many Requests" }));
      await expect(transport(message)).resolves.toBe("failed");
    }
  });

  it("trata erro de rede como falha temporária, nunca como revogação", async () => {
    const transport = createTelegramTransport("token", (async () => {
      throw new Error("network down");
    }) as typeof globalThis.fetch);
    await expect(transport(message)).resolves.toBe("failed");
  });

  it("manda texto puro: sem parse_mode no corpo", async () => {
    let captured: string | undefined;
    const transport = createTelegramTransport("token", (async (_url: unknown, init: RequestInit) => {
      captured = init.body as string;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch);

    await transport(message);
    expect(captured).toBeDefined();
    expect(JSON.parse(captured!)).toEqual({ chat_id: "42", text: "oi" });
  });
});
