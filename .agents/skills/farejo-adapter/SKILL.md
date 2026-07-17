---
name: farejo-adapter
description: >
  Escrever, consertar ou revisar adapters/parsers dos portais de cashback do farejô
  (méliuz, cuponomia, mycashback, zoom, inter). Use quando: criar adapter novo, adicionar
  portal, investigar run 'suspicious' ou queda de ofertas ativas, mexer em apps/scraper
  ou poc/src, atualizar fixtures de contrato, ou quando um parser "passa" mas as contagens
  parecem erradas.
---

# Adapters do farejô

Regras destiladas da validação `--live` de 09/07/2026 (5 sites, crawls completos).
Detalhes por site: `poc/README.md`. Implementações de referência: `poc/src/*.ts`.

## O contrato

```ts
interface RawOffer {
  storeName: string;           // cru, como o site exibe
  rewardText: string;          // cru: "7% Cashback", "até 4% de cashback", "R$ 25"
  previousRewardText?: string; // boost: "era 2%"
  partialRewardText?: string;  // tier inferior de acesso (inter: não-correntista). Genérico: shared não sabe "correntista"
  url: string;                 // link de redirecionamento no portal
  logoUrl?: string;
}

type RunScope =
  | { kind: 'full' }                          // inter, mycashback: varredura completa
  | { kind: 'partial'; slugs: Set<string> };  // coleta tiered (fase 2): só a fatia visitada

interface ScrapeResult {
  offers: RawOffer[];
  scope: RunScope;            // fase 1: { kind: 'full' }
  declaredTotal?: number;     // só onde o site declara um total de MÁQUINA autoritativo
  rawCount: number;           // itens recebidos com desfecho real, ANTES do filtro de inativas
  softBlocks: number;         // soft-blocks acumulados (adapter conta; pipeline aplica o limiar)
}
interface PlatformAdapter { platformId: string; scrape(): Promise<ScrapeResult>; }
```

**Adapter só EXTRAI.** Parse de valor, normalização de nome e ativo/inativo vivem no
pipeline compartilhado. Se você está escrevendo `parseFloat` ou lógica de negócio dentro
de um adapter, pare. Os campos de `ScrapeResult` além de `offers` são **metadados de
coleta** (fatos que só o adapter observa: quantos itens vieram, o que o site declarou,
quantos soft-blocks) — não são interpretação. Quem compara `declaredTotal` vs `rawCount`,
quem decide o **escopo** da desativação e quem aplica o **limiar** de soft-blocks é o
**pipeline**, com o número em config compartilhada — nunca hardcoded no adapter.

## As 5 leis (violação = bug que já tivemos)

1. **HTTP 200 ≠ a página que você pediu.** Todo parser de página de loja exige um
   **sinal de presença** (`.store_header` no cuponomia, `.hero-sec` no méliuz).
   Ausência = **erro retentável com backoff** (8/16/24s), NUNCA "loja sem cashback".
   O cuponomia devolve 200 com a home sob crawl sustentado — 17% do 1º crawl virou
   falso "sem página" por isso.
2. **Nunca confie na contagem do seu parser sem cruzar com um total declarado pelo site.**
   A regra 4 do sanity check compara `declaredTotal` vs `rawCount` (itens **recebidos**),
   **não** vs `offers.length` (ofertas ativas) — senão o inter dispara `suspicious` em toda
   run saudável (declara 374, recebe 374, mas só 363 têm cashback: 11 são `fullCashbackValue:0`).
   ⚠️ **`declaredTotal` só existe onde há total de máquina autoritativo**: inter
   (`pagination.total` + cross-check `/v1/departments.numStores`) e zoom (`"N lojas
   encontradas"` vs `sellers.length`). Cuponomia/méliuz deixam `declaredTotal` **undefined**:
   o diretório deles não é autoritativo (viajanet morta = 799 declarados vs 798 reais =
   mismatch permanente que dispararia para sempre). Nesses sites quem protege é a regra 2
   (queda de ofertas ativas) + o tratamento de soft-block; `rawCount` = páginas com desfecho real.
3. **Inativa é sinal explícito, não ausência de dado.** mycashback: `.cbDetails` com
   `"Sem  Cashback"` (DOIS espaços — use `/sem\s+cashback/i` e `!/\d/`). inter:
   `fullCashbackValue: 0`. zoom: `bestFormula` null. Confundir isso criou 7 ofertas
   fantasma.
4. **Ordem de preferência da fonte:** API aberta > JSON embutido (`__NEXT_DATA__`,
   `self.__next_f`) > data-attributes > texto do DOM. Classes CSS-module/styled-components
   só por **prefixo** (`[class*="CouponSellerCard_Cashback"]`) — o hash muda por build.
   API privada (OAuth com secret no bundle, ex. méliuz) = **não usar**.
5. **Crawls são retomáveis e abortáveis.** Desfecho por slug em JSONL/`crawl_state`
   append-only; slug só é "feito" com desfecho real (`offer | no_cashback | not_found`);
   `soft_block` re-tenta; **12 soft-blocks consecutivos abortam a run inteira** (dados
   do run anterior continuam servindo). **`soft_block` nunca avança `crawl_state`**
   (nem `tier` nem `last_checked_at`) — não é desfecho real, então o slug continua
   vencido e cai na próxima fatia. Deixar `soft_block` avançar o relógio faria um slug
   bloqueado da cauda esperar +5 dias: é o bug dos 17% do crawl original reaparecendo
   dentro do agendador (ADR-0001, atualização Fase 2).

## Ficha dos 5 sites

| Site | Fonte | Lojas | Inativa | Presença/cross-check | Pegadinhas |
|---|---|---|---|---|---|
| **inter** | API JSON aberta `marketplace-api.web.bancointer.com.br/.../search/stores?limit=400` (1 req) | 374 | `fullCashbackValue: 0` (11) | `pagination.total` + `/v1/departments.numStores` | `partialCashbackValue` = tier não-correntista (→ `value_partial`), NÃO é "até"; boost = campo `previousCashback` (opcional); `fullCashbackType` tratar defensivamente |
| **mycashback** | `/all-shops` HTML, 1 página (1 req) | 461 de 468 cards | `.cbDetails` = `"Sem  Cashback"` | contagem de cards ≈ 468 | logo real em `data-src` (o `src` é sempre noimage.jpg); formatos `Até 11%`, `até 3%`, `Até* 20%` |
| **cuponomia** | diretório `/desconto` (799) → páginas de loja | 524 ativas / 274 não | header sem `data-cashback-displayed` | `.store_header` (soft-block!) | data-attrs são a fonte (`data-store-name/-cashback-displayed/-actual`); `displayed` vem `"até 4%"` quando up_to; 15 lojas em R$; boost = `del.rewardsTag-previous` + classe `has-store-boost-cashback` (concordam 38/38); 29 ativas sem `aside.rewardsTag`; **tiered**: 524 ativas 2×/dia, 274 a cada 5 dias; ≥1,3s entre requests |
| **méliuz** | diretório `/desconto` (2355, SEM valores) → páginas de loja | 664 ativas / 1687 cupom-only | botão `.hero-sec__redirect-btn button` diz "Ativar cupom exclusivo" | `.hero-sec` | valor no botão ("Ativar até X% / R$ Y de cashback") + taxa base em `.hero-sec__cashback-category strong[data-main]`; **42 lojas em R$ fixo**; nome/logo do `ld+json @type:Store` (derivar de slug erra ~10%); **tiered**: 664 2×/dia + 1687 fatiadas 1×/5 dias; API privada — não usar |
| **zoom** | flight RSC `self.__next_f` → array `"sellers"` (1 req, sem paginação) | 171 ativas / 212 | `bestFormula` null (NÃO use `allMerchant`) | header `"N lojas encontradas"` | `bestFormula` é fração (0,005 = 0,5%): `×100` + `toFixed(4)`; `is_upto` = >1 taxa positiva em `[allMerchant, offerRates.min/max, categories[].cashbackRate]`; só %, sem boost |

## Workflow (novo adapter ou conserto)

1. Capture o HTML/JSON real (`--live`) → salve como fixture integral.
2. Escreva/ajuste o **teste de contrato** contra a fixture (vermelho primeiro).
3. Implemente/conserte o parser até verde.
4. Rode `--live` e **valide contra o total declarado** + contagens esperadas da ficha.
5. Atualize a ficha acima e o `poc/README.md` se algo mudou no site.

Nunca edite um parser sem fixture nova — fixture velha verde + site mudado = falsa segurança.

## Sanity checks do pipeline (o adapter alimenta, o pipeline decide)

`offers_found` e `active_offers` < 60% da média dos 5 últimos runs ok → `suspicious`, não grava.
`parse_errors` > 10% → idem. Total declarado ≠ extraído → idem. O soft-block derruba
**ofertas ativas** sem mudar o total de lojas — vigie as duas métricas.
