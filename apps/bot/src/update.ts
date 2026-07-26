import { z } from "zod";

/**
 * F4/#118 (ADR-0065) — os únicos tipos de update que o webhook precisa: comando de texto e a
 * mudança de status do bot no chat (bloqueio, ADR-0066). É o valor pretendido para o parâmetro
 * `allowed_updates` de `setWebhook` — que restringe o que o Telegram chega a ENVIAR, reduzindo
 * superfície antes mesmo do zod entrar em cena.
 *
 * Nenhum código deste repo chama `setWebhook` ainda (registro do webhook é operação manual,
 * pendência operacional do CLAUDE.md, provavelmente de um ticket de publicação futuro). Esta
 * constante deixa o contrato pronto em código para quando esse chamador existir, em vez de o
 * valor viver só em prosa de ADR.
 */
export const ALLOWED_UPDATE_TYPES = ["message", "my_chat_member"] as const;

/**
 * F4/#116 (ADR-0066) — allowlist de campos do update do Telegram.
 *
 * O payload real traz `first_name`, `last_name`, `username`, `language_code`, `is_premium` e o
 * texto inteiro da mensagem. Este schema é a primeira linha da defesa de dado mínimo: o zod
 * descarta tudo que não está declarado, então nada além do id do chat e do comando sobrevive à
 * fronteira. Não é filtro cosmético — é o motivo de o resto do código não ter como vazar o que
 * não recebeu.
 *
 * `message` e `my_chat_member` são opcionais porque o Telegram entrega outros tipos de update
 * (mesmo restringindo `allowed_updates`, o payload de um tipo permitido ainda pode faltar); o
 * handler ignora o que não sabe tratar, sempre com 200 (um não-2xx faria o Bot API reenviar para
 * sempre).
 *
 * `my_chat_member.new_chat_member` de verdade também traz `user` (id, nome, @ de quem mudou o
 * status). Fora daqui de propósito (ADR-0066): o único sinal que este handler usa é `status`
 * (`"kicked"` = bloqueou o bot), e é o único campo que sobrevive à fronteira.
 */
export const TelegramUpdate = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number().int() }),
      text: z.string(),
    })
    .optional(),
  my_chat_member: z
    .object({
      chat: z.object({ id: z.number().int() }),
      new_chat_member: z.object({ status: z.string() }),
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
