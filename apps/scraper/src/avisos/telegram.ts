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
 * Sinais definitivos de revogação, segundo o Bot API: 403 quando a pessoa bloqueou o bot, 400
 * quando o chat não existe mais (conta apagada). Qualquer outro status é falha temporária — a
 * entrega fica para o run seguinte, e o cursor não avança.
 */
function outcomeForStatus(status: number): TransportOutcome {
  return status === 403 || status === 400 ? "revoked" : "failed";
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

      if (!response.ok) return outcomeForStatus(response.status);

      const payload = TelegramResponse.safeParse(await response.json());
      return payload.success && payload.data.ok ? "sent" : "failed";
    } catch {
      // Rede, timeout, JSON inválido: temporário por definição. Nunca revogação — apagar dado
      // pessoal exige um sinal definitivo, não a ausência de resposta.
      return "failed";
    }
  };
}
