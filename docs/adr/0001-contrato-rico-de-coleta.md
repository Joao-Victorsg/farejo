# Contrato de coleta rico (`ScrapeResult`), interpretação permanece no pipeline

O `scrape()` de cada adapter devolve um `ScrapeResult` (`{ offers, scope, declaredTotal?, rawCount, softBlocks }`) em vez de `RawOffer[]` cru. Decidimos assim porque os sanity checks e a desativação por ausência precisam de fatos que **só o adapter observa** — o total que o site declara sobre si (`pagination.total`), o escopo do run, quantos itens vieram, quantos soft-blocks — e um array cru os descartaria. O limite "adapter só extrai" é preservado: esses campos são **metadados de coleta**, não interpretação; quem compara `declaredTotal` vs `rawCount`, decide o escopo da desativação e aplica o limiar de soft-blocks é o **pipeline**, com os números em config compartilhada.

## Consequências

- A regra 4 do sanity check compara `declaredTotal` vs `rawCount` (itens recebidos), **não** `offers.length` — senão o inter (declara 374, recebe 374, 363 ofertas) dispararia `suspicious` em toda run saudável.
- `declaredTotal` é preenchido **só** onde há total de máquina autoritativo (inter, zoom). Cuponomia/méliuz o deixam `undefined`: o diretório não-autoritativo geraria mismatch permanente (viajanet morta = 799 vs 798). Lá a proteção é a regra 2 (queda de ofertas ativas) + tratamento de soft-block.
- `RunScope` entra como union desde a Fase 1 (só o ramo `full` implementado), para o pipeline não mudar de assinatura quando a coleta tiered chegar na Fase 2.
- O `poc/src/shared.ts` **não** muda — é POC histórico; o contrato real nasce em `packages/shared`.

## Atualização (Fase 2): `ScrapeResult` ganha desfecho por slug

Sites com **coleta tiered** (cuponomia, méliuz) precisam manter `crawl_state.tier` sincronizado com o que cada loja revelou — e isso tem que acontecer na **mesma transação** de `pipeline_write_offers`, senão uma falha entre "escrever oferta" e "atualizar tier" perde a promoção em silêncio. Para isso, `ScrapeResult` desses sites passa a expor o desfecho por slug, não só o array agregado de ofertas:

```ts
type SlugOutcome =
  | { slug: string; outcome: "offer"; offer: RawOffer }
  | { slug: string; outcome: "no_cashback" | "not_found" | "soft_block" };

interface ScrapeResult {
  offers: RawOffer[];
  outcomes?: SlugOutcome[]; // só sites com crawl_state (cuponomia, méliuz); independe de scope.kind
  scope: RunScope;
  declaredTotal?: number;
  rawCount: number;
  softBlocks: number;
}
```

- União discriminada por slug (não dois arrays `offers[]`/`outcomes[]` paralelos) para tornar estado inválido irrepresentável — dois arrays que podem discordar seriam uma classe nova de bug (princípio da skill `farejo-typescript`).
- **`soft_block` nunca atualiza `crawl_state`** (nem `tier` nem `last_checked_at`): não é desfecho real (ver `CONTEXT.md`), então o slug continua vencido e entra na próxima fatia. Se `soft_block` avançasse o relógio, um slug bloqueado da cauda esperaria +5 dias — reintroduziria o bug dos 17% do crawl original, agora dentro do agendador.
- `outcomes` é função de "o site tem `crawl_state`", não do `scope.kind` — a varredura de bootstrap (full) de cuponomia/méliuz também reporta desfecho por slug, pelo mesmo motivo.
- Regra de tier (pipeline, mesma transação): `offer` → `tier='active'`; `no_cashback`/`not_found` → `tier='tail'`. Sem histerese (muda no primeiro desfecho oposto) e sem estado adicional para `not_found` repetido — ambos YAGNI, ver `CONTEXT.md`.
