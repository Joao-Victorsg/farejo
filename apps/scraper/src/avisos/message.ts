/**
 * F4/#114 — agrupamento e redação do Aviso. Parte PURA: nada aqui toca banco, rede ou env.
 *
 * A detecção mora em SQL (`alerts.pending_avisos`, ADR-0064); daqui para frente é apresentação.
 */

export interface PendingTransition {
  subscriberId: number;
  telegramChatId: string;
  historyId: string;
  storeName: string;
  platformName: string;
  rewardType: string;
  value: number;
  isUpto: boolean;
  /** `null` quando não havia valor anterior conhecido: é oferta nova. */
  previousValue: number | null;
  previousIsUpto: boolean;
}

export interface Aviso {
  subscriberId: number;
  chatId: string;
  text: string;
}

/** "5%", "4,5%", "até 10%", "R$ 15", "R$ 15,50" — pt-BR, sem zero à direita inútil. */
export function formatReward(value: number, rewardType: string, isUpto: boolean): string {
  const decimals = Number.isInteger(value) ? 0 : 2;
  const number = value.toFixed(decimals).replace(".", ",");
  const rendered = rewardType === "fixed" ? `R$ ${number}` : `${number}%`;
  return isUpto ? `até ${rendered}` : rendered;
}

/**
 * Uma linha por transição, sem colapsar o lote num degrau só.
 *
 * Colapsar (`3% → 5%` + `5% → 7%` viram `3% → 7%`) parece mais limpo e esconde informação que a
 * pessoa pediu: a decisão de produto é que TODA oscilação avisa. Um lote `12% → 14% → 12%`
 * colapsado viraria `12% → 12%`, escondendo as duas mudanças de uma vez.
 *
 * No caso normal — um run, uma transição por par (loja, plataforma) — as duas formas são
 * idênticas. Lote com mais de uma transição só acontece quando a entrega atrasou (Telegram fora
 * do ar), e aí mostrar o caminho inteiro é o comportamento certo.
 */
function formatLine(transition: PendingTransition): string {
  const current = formatReward(transition.value, transition.rewardType, transition.isUpto);
  if (transition.previousValue === null) return `• ${transition.platformName}: novo, ${current}`;

  const previous = formatReward(transition.previousValue, transition.rewardType, transition.previousIsUpto);
  return `• ${transition.platformName}: ${previous} → ${current}`;
}

/**
 * Um Aviso por assinante (ADR-0063), agrupado por Loja canônica e, dentro dela, por Plataforma.
 *
 * Preserva a ordem em que as transições chegam — a função SQL já as devolve ordenadas por chat,
 * nome de loja, plataforma e id de histórico, e reordenar aqui só criaria uma segunda fonte de
 * verdade sobre a ordem.
 */
export function buildAvisos(transitions: readonly PendingTransition[]): Aviso[] {
  const bySubscriber = new Map<number, PendingTransition[]>();
  for (const transition of transitions) {
    const list = bySubscriber.get(transition.subscriberId);
    if (list) list.push(transition);
    else bySubscriber.set(transition.subscriberId, [transition]);
  }

  return [...bySubscriber.entries()].map(([subscriberId, subscriberTransitions]) => {
    const byStore = new Map<string, Map<string, PendingTransition[]>>();
    for (const transition of subscriberTransitions) {
      const platforms = byStore.get(transition.storeName) ?? new Map<string, PendingTransition[]>();
      byStore.set(transition.storeName, platforms);
      const list = platforms.get(transition.platformName);
      if (list) list.push(transition);
      else platforms.set(transition.platformName, [transition]);
    }

    const blocks = [...byStore.entries()].map(([storeName, platforms]) => {
      const lines = [...platforms.values()].flatMap((group) => group.map(formatLine));
      return [storeName, ...lines].join("\n");
    });

    return {
      subscriberId,
      chatId: subscriberTransitions[0]!.telegramChatId,
      // Cabeçalho NEUTRO de propósito: no Modo acompanhamento uma linha pode ser queda que
      // continua acima do Piso, e "subiu!" mentiria. Os dois valores de cada linha mostram a
      // direção, e o "até" mostra a natureza.
      text: ["🔔 Mudou o cashback nas suas lojas", "", ...blocks].join("\n\n"),
    };
  });
}
