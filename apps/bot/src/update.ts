import { z } from "zod";

/**
 * F4/#116 (ADR-0066) — allowlist de campos do update do Telegram.
 *
 * O payload real traz `first_name`, `last_name`, `username`, `language_code`, `is_premium` e o
 * texto inteiro da mensagem. Este schema é a primeira linha da defesa de dado mínimo: o zod
 * descarta tudo que não está declarado, então nada além do id do chat e do comando sobrevive à
 * fronteira. Não é filtro cosmético — é o motivo de o resto do código não ter como vazar o que
 * não recebeu.
 *
 * `message` é opcional porque o Telegram entrega outros tipos de update; o handler ignora o que
 * não sabe tratar, sempre com 200 (um não-2xx faria o Bot API reenviar para sempre).
 */
export const TelegramUpdate = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number().int() }),
      text: z.string(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

export interface ParsedCommand {
  command: string;
  argument: string | undefined;
}

/**
 * `/start amazon` → `{ command: "/start", argument: "amazon" }`.
 *
 * Aceita a forma `/comando@nomedobot`, que o Telegram usa em grupo — o farejô só opera em chat
 * privado, mas ignorar o sufixo é mais barato que explicar por que o comando não funcionou.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const command = head!.split("@")[0]!.toLowerCase();
  const argument = rest.join(" ").trim();

  return { command, argument: argument === "" ? undefined : argument };
}
