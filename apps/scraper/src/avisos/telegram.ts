import { z } from "zod";

/**
 * F4/#114 — envio de Aviso, com desfecho tipado.
 *
 * NÃO reusa `sendTelegramMessage` (summary.ts) de propósito, apesar da semelhança. Aquele é
 * observabilidade operacional e o contrato dele é "degrada em silêncio, devolve boolean, nunca
 * relança" — perfeito para o resumo de run, e insuficiente aqui: os Avisos precisam distinguir
 * **revogação** (a pessoa bloqueou o bot ou apagou a conta) de **falha temporária**, porque a
 * primeira apaga dado pessoal (ADR-0066) e a segunda só adia a entrega. Um boolean não carrega
 * essa diferença, e alargar o contrato do outro para caber os dois casos pioraria os dois.
 */
export type TransportOutcome = "sent" | "revoked" | "failed";

export interface AvisoMessage {
  chatId: string;
  text: string;
}

export type AvisoTransport = (message: AvisoMessage) => Promise<TransportOutcome>;

const TelegramResponse = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

/**
 * Descrições de 400 que significam "este chat não existe mais". O Bot API usa 400 para QUALQUER
 * erro de cliente — inclusive "message is too long" —, então status sozinho não distingue
 * revogação de problema de conteúdo. E a diferença é grave: revogação apaga dado pessoal
 * (ADR-0066), irreversivelmente. Um lote acumulado grande devolveria 400, e tratar isso como
 * revogação apagaria um assinante ativo por causa do TAMANHO da própria mensagem.
 */
const CHAT_GONE_DESCRIPTIONS = ["chat not found", "user is deactivated", "peer_id_invalid", "chat_id is empty"];

/**
 * Revogação exige sinal DEFINITIVO. 403 é sempre definitivo em chat privado (bot bloqueado, conta
 * desativada, bot removido). 400 só conta quando a descrição diz que o chat sumiu; qualquer outro
 * 400 é problema nosso, não da pessoa, e vira falha temporária — a entrega fica para o run
 * seguinte e o cursor não avança.
 */
function outcomeFor(status: number, description: string | undefined): TransportOutcome {
  if (status === 403) return "revoked";
  if (status !== 400) return "failed";

  const normalized = (description ?? "").toLowerCase();
  return CHAT_GONE_DESCRIPTIONS.some((known) => normalized.includes(known)) ? "revoked" : "failed";
}

export function createTelegramTransport(token: string, fetchImplementation: typeof globalThis.fetch = globalThis.fetch): AvisoTransport {
  return async ({ chatId, text }) => {
    try {
      const response = await fetchImplementation(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Sem `parse_mode`, deliberadamente: nome de loja entra cru na mensagem, e sem markup não
        // há o que escapar nem o que injetar (ADR-0065).
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });

      // O corpo é lido MESMO em erro: `description` é o único campo que distingue chat inexistente
      // de mensagem malformada, e é ele que decide se um assinante será apagado.
      const payload = TelegramResponse.safeParse(await response.json().catch(() => null));
      const description = payload.success ? payload.data.description : undefined;

      if (!response.ok) return outcomeFor(response.status, description);

      return payload.success && payload.data.ok ? "sent" : "failed";
    } catch {
      // Rede, timeout, JSON inválido: temporário por definição. Nunca revogação — apagar dado
      // pessoal exige um sinal definitivo, não a ausência de resposta.
      return "failed";
    }
  };
}
