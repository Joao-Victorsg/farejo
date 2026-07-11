# farejô — POCs dos scrapers

POC por site: valida seletores, formatos de valor e estratégia de coleta. Cada script roda em dois modos:

```bash
npm install
npm run inter          # contra fixture (offline, rápido — o que os testes de contrato farão)
npx tsx src/inter.ts --live   # contra o site real
```

Adapters: `inter` · `mycashback` · `cuponomia` · `meliuz` · `zoom`.

Recon/análise (offline salvo onde indicado):
`normalize` (normalização de nomes + candidatos a alias) · `assets` (logos: origem, hotlink, peso) ·
`mel-store-page --live` (nome/logo/valor da página de loja do méliuz) · `mel-dataset` (reconstrói o
dataset ativo do méliuz a partir do crawl) · `mel-recon` · `mel-crawl` · `mel-analyze` ·
`cup-crawl` (crawl das 799 lojas do cuponomia, **retomável**) · `cup-analyze`.

Os crawls (`mel-crawl`, `cup-crawl`) são retomáveis: gravam JSONL append-only e pulam quem já teve
desfecho real. Interromper e rodar de novo continua de onde parou.

O modo `--live` também salva o HTML integral em `fixtures/*.html`.

---

## Status da validação `--live` (09/07/2026)

| Site | Esperado | Real | Veredito |
|---|---|---|---|
| inter | ≈374 | **374** (via API JSON) | ⚠️ contagem ok, mas **parser HTML não serve** — página é shell client-side |
| mycashback | ≈468 | **468 cards / 461 ofertas** | ⚠️ parser emite 7 ofertas fantasma ("Sem Cashback") |
| cuponomia | ≈799 | **799** no diretório → 798 páginas → **524 ofertas** (crawl completo) | ✅ parser corrigido (boost, `R$`, `até X%`, soft-block) |
| méliuz | 200–380 | **174** (21 categorias, 258 cards → 217 → 174 pós-dedupe) | ❌ cobertura muito abaixo do necessário |
| zoom | teste anti-bot | **212 lojas / 171 ofertas** (via payload RSC) | ✅ anti-bot não bloqueou; parser DOM via só 24 → **reescrito** |

Nenhum dos 5 parsers estava pronto para virar adapter sem correção (zoom já corrigido). Detalhes abaixo.

---

## Descobertas do `--live` (corrigem o recon anterior)

### 1. Inter não é scraping de HTML — é uma API JSON pública

`GET /site-parceiro/lojas?category=ALL-STORES` devolve 80 KB de **shell estático**
(`__NEXT_DATA__` com `"pageProps":{}`, `nextExport:true`). Os cards são renderizados no cliente.
O `parseInter` atual retorna **0 ofertas** contra o HTML servido — a fixture
`inter-lojas.sample.html` foi reconstruída a partir do DOM *renderizado*, por isso "funcionava".

O bundle chama:

```
GET https://marketplace-api.web.bancointer.com.br/site/affiliate/inter/v1/search/stores
    ?lang=pt-BR&limit=400&offset=0
```

Sem auth. Devolve `{ stores: [...], pagination: {offset,limit,total,isLastPage} }` →
`total: 374`, `isLastPage: true` (1 request). Cross-check independente:
`/v1/departments` → `{"id":"ALL-STORES","numStores":374}`.

Shape de cada loja (fixture: `fixtures/inter-stores.api.json`):

```json
{ "id":"…", "slug":"drogaria-venancio", "name":"Drogaria Venancio",
  "fullCashback":"4.9% cashback", "fullCashbackValue":4.9, "fullCashbackType":"PERCENTUAL",
  "partialCashback":"3.43% cashback", "partialCashbackValue":3.43,
  "imageUrl":"…", "highlight1":false, "highlight2":false,
  "promotionTag":"Cupons disponíveis", "redirectWarning":"…" }
```

Notas que mudam o design:

- **`previousCashback` (boost) é campo da API, opcional.** O componente `StoreCard` faz
  `!!n.previousCashback && createElement(l.PreviousCashback, null, n.previousCashback)`.
  Hoje **nenhuma loja** está em boost, por isso o campo não aparece na resposta.
  O `Era 10%` da fixture reconstruída era invenção — mas o mecanismo existe. Ler o campo, não parsear DOM.
- **`CashbackValue` renderiza `fullCashback` verbatim.** Logo o `"Até 77% de cashback"` da fixture
  também é artefato: a API diz `"77% cashback"`. Hoje **0 lojas** têm "até" no texto. Manter detecção de `is_upto`, mas ela não dispara.
- **`partialCashbackValue` NÃO é indicador de "até".** É o tier de conta (≈0.7× o full, mas a razão
  varia: 0.5 na Bulbe, 0.57 no iPlace, 0.6 na Sephora…). Ignorar para o comparador; usar `fullCashbackValue`.
- **11 lojas com `fullCashbackValue: 0`** e `fullCashback: "Ofertas disponíveis"` (Amazon, Mercado
  Livre etc.) → não são ofertas (F8).
- `fullCashbackType` é `"PERCENTUAL"` em 374/374. O enum sugere outro valor possível — tratar defensivamente.
- `promotionTag` ∈ {`Cupons disponíveis`, `Ofertas especiais`, `Cupons e ofertas`} — é badge de cupom, **não** boost.

### 2. MyCashback: 7 ofertas fantasma

`/all-shops` = 468 cards, **sem paginação** (nenhum `.pagination`, `rel=next`, "carregar mais" — pendência resolvida).

Mas o aprendizado antigo ("loja inativa = card **sem** `.cbDetails`") está **errado**. As 7 inativas
têm `.cbDetails` com o texto `"Sem  Cashback"` (dois espaços). O parser atual só testa `!rewardText`,
então **emite as 7 como ofertas válidas**. Ofertas reais: **461**.

Inativas: Estante Virtual, Trivago, Amazon.com.br, Ortobom Colchões, Homedock, Mercado Livre, Kopenhagen.

Fix: descartar quando `!/\d/.test(rewardText)` ou `/sem\s+cashback/i.test(rewardText)` (o `\s+` cobre o espaço duplo).

### 3. Cuponomia: markup de boost é elemento dedicado; existe valor em R$; e o site **soft-bloqueia**

**Crawl completo das 799 lojas (09/07/2026, `src/cup-crawl.ts` → `fixtures/cuponomia-crawl.jsonl`).**
Números reais, não mais extrapolação:

| | |
|---|---|
| slugs no diretório | **799** |
| páginas de loja reais | **798** (`viajanet` morreu: canonical → `/cupom/viagem-e-turismo`) |
| **com cashback** | **524 (65,7%)** — a amostra n=30 dizia 60% (~479): subestimava |
| sem cashback | 274 |
| em `%` / em `R$` | 509 / **15** |
| `up_to=true` | **28** |
| em boost | **38** |
| ativas sem `aside.rewardsTag` | 29 |

- 🐛 **O cuponomia soft-bloqueia sob crawl sustentado — e não avisa.** Não devolve 429/403: devolve
  **HTTP 200 com a home**. Na 1ª passada, **138 das 799 (17%)** vieram assim; o parser não achava
  `.store_header` e elas foram gravadas como "loja sem página". Re-buscando 12 delas na hora, **12/12
  reviveram** (`Chico Rei 5%`, `Norton 31%`, `Iberia 0,3%`…). O `soft404` era mentira.
  → **Um 200 sem `.store_header` é bloqueio, não ausência de loja.** O `cup-crawl.ts` agora faz backoff
  (8/16/24 s, 4 tentativas) e **aborta a run** após 12 soft-blocks seguidos, em vez de gravar lixo.
  Na 2ª passada (carga leve, só 138 slugs) foram só **4 retries** e **1 soft-404 real**.
  ⚠️ Isso é perigoso porque **não derruba a contagem de lojas** — transforma ativa em inativa. O sanity
  check da run precisa vigiar a **queda de ofertas ativas**, não só o total de lojas.
- 🐛 **`data-cashback-displayed` nem sempre é `"2%"`.** Quando `up-to=true` vem **`"até 4%"`** (28 lojas) e
  o `parseFloat` devolvia `NaN` → todas as 28 ficavam com `value:null`. Corrigido no `parseDisplayed()`,
  compartilhado pelo crawler e pela análise.
- ✅ **Pendência fechada:** `data-store-cashback-actual` **prefixa "até"** quando `data-should-use-up-to=true`.
  As 30 lojas amostradas antes não tinham nenhuma com a flag; no diretório inteiro há **28**, e **28/28**
  prefixam (`arno` → `"até 4% de cashback"`).
- **`data-conversion-rate` bate com o `displayed` em 100% das ativas** (0 divergências) — bom cross-check
  de máquina. Mas **29 lojas com cashback não têm o `aside.rewardsTag`** (logo, `rate=null`): nesses casos
  o `up_to` sai do prefixo `"até "` do próprio `displayed`.
- **Boost: a classe `has-store-boost-cashback` e o `del.rewardsTag-previous` concordam 38/38**, nos dois
  sentidos (0 classe-sem-`<del>`, 0 `<del>`-sem-classe). Os dois sinais são confiáveis.
- **`data-store-name` == texto do anchor do diretório em 798/798** — o diretório serve de fonte de nome.
- Distribuição %: `<1%`:37 · `1–3%`:201 · `3–5%`:162 · `5–10%`:77 · `10%+`:32 · mediana **3%** · máx 50%.
- **15 lojas pagam R$ fixo** (não só `sams-club`): Amazon Music R$ 5 · Globoplay R$ 20 · PagBank R$ 24 ·
  Google Workspace R$ 17 · Crunchyroll R$ 5 · Locaweb R$ 4,5 · Porto Seguro Celular R$ 15 · One Travel R$ 12…
- **Boost encontrado** (`iplace`, fixture `cuponomia-loja-boost.html`):

```html
<aside data-test-id="rewards-tag" class="rewardsTag js-rewardsTag has-store-boost-cashback"
       data-conversion-rate="0,01500" data-should-use-up-to="false" data-store-id="3074">
  <del class="rewardsTag-previous">(era 1%)</del>
```

  → usar `del.rewardsTag-previous` (elemento) e a classe `has-store-boost-cashback` (flag).
  **Não** usar regex sobre `header.text()`: o `.store_header` contém um `<style>` inline, então
  `.text()` devolve ~7 KB de CSS antes do conteúdo — o match atual cai dentro do CSS (offset 6911).
  Qualquer string `era 5%` numa regra CSS vira falso positivo.

- **`R$` fixo existe** — contradiz o aprendizado #4 antigo. `sams-club` → `data-cashback-displayed="R$ 8,5"`,
  `data-store-cashback-actual="R$ 8,5 de cashback"`, `data-conversion-rate="8,50000"`.
  Fixture: `cuponomia-loja-brl.html`. O `parseReward` **precisa** cobrir `R$ X,Y`, e a UI nunca pode
  comparar isso com `%` (já previsto no design).
- `data-conversion-rate` é o número de máquina (vírgula decimal): `"0,00200"` = 0,2% ; `"8,50000"` = R$ 8,50.
  Desambiguar pelo `R$` em `data-cashback-displayed`.
- `data-should-use-up-to` / `data-conversion-rate` ficam num **descendente** (`aside.rewardsTag`), não no
  `.store_header` — o `.find()` atual está certo. Mas nem toda loja com cashback tem esse aside
  (ex.: `hostinger`, 15%, sem `rewardsTag`) → tratar ausência como `up_to=false`.
- `data-store-cashback-actual` já traz a string de exibição pronta ("0,2% de cashback").
- Slug inexistente → **soft-404**: HTTP 200 servindo a home, sem `.store_header` → parser devolve `null`. Ok, mas
  significa que não dá para confiar no status code.

### 4. Méliuz: 21 categorias cobrem só 174 lojas de 2359

Todas as 21 categorias respondem 200 (nenhum slug morto). Cards por categoria são 6/12/18, não "~18":
258 cards → 217 ofertas → **174 únicas**. Muito abaixo de inter (374), mycashback (461), cuponomia (~479).

Para um comparador isso é grave: sem o valor do méliuz numa loja, o "quem paga mais" fica errado.

Caminho resolvido nesta sessão:

- `GET /desconto` → **2359 lojas únicas numa única request** (`a[href^="/desconto/"]`, 2395 anchors).
  Sem paginação por letra (o `?letra` que apareceu era a loja `porto-de-letras`).
- **Mas o diretório não traz valor nenhum** (`de cashback` aparece 1×, é cabeçalho; sem `cashback-label`,
  sem `data-cashback`). Esgotado: não dá para extrair valor de lá.
- **A página da loja traz o valor no HTML servido** (fetch simples, sem JS):
  `/desconto/cupom-magazine-luiza` → `"+ até 10% cashback"` / `"10% de cashback"`;
  `/desconto/cupom-de-desconto-nike` → `"+ 2% cashback"`.
  Fixture: `meliuz-loja.html` · diretório: `meliuz-desconto.html`.

**Investigado a fundo em 09/07/2026 (recon `poc/src/mel-recon.ts`):**

- **API descartada (privada):** o site é Vue/Pinia sobre `api-seo.meliuz.com.br`. Diferente do inter
  (endpoint aberto sem auth), exige OAuth `client_credentials` (`client_id=meliuz-client-seo-production`
  + `client_secret` embutido no bundle). Usar = extrair o secret e se passar pelo frontend deles → API
  não pensada para terceiros. **Decisão: só HTML público.**
- **Seletor estável da página da loja (resolvido):**
  `.hero-sec__redirect-btn button` → texto `"Ativar até X% de cashback"` (tem) vs `"Ativar cupom exclusivo"`
  (não tem). Valor no `<span>` interno; taxa base em `.hero-sec__cashback-category strong[data-main]`.
  Descontos de cupom ficam em `.cpn-*`/`.offer-cpn__cashback` — não confundir.
- **O diretório é ~72% cupom-only.** **Crawl completo das 2355 lojas** (`poc/src/mel-crawl.ts`,
  ~57 min a 1,3s, gravando `fixtures/meliuz-crawl.jsonl`): **664 têm cashback (28%)**, 1687 cupom-only,
  4 são 404. A amostra n=120 tinha subestimado (~480) — a cauda ativa real é 22,6%, não 14%.
  Hot set (171 ativas no diretório) cobre só **26%** do universo → **cauda ativa = 493 lojas**.
- **⚠️ 42 lojas pagam cashback em R$ FIXO** (`"Ativar R$ 25,00 de cashback"` — apostas, educação,
  antivírus), não %. O adapter precisa parsear R$ além de % no botão do hero. Distribuição do resto:
  concentrada em 1–5% (275 em 1–3%, 172 em 3–5%); só 9 são "até X%".
- 🐛 **`meliuz-active-stores.json` estava com 42 linhas sem valor.** As 664 linhas existiam, mas as 42 em R$
  tinham `value:null` — o valor só ficou no campo `btn` do `crawl.jsonl`. Reconstruído por
  `src/mel-dataset.ts`: agora **664 lojas, todas com valor** (622 `percent` + 42 `brl`), campo `kind` novo.
- **O dataset NÃO tem o nome da loja** (só `slug`) — e o slug não serve: `cupom-anhaguera` → "Anhanguera
  Graduação" (o slug tem typo), `coral-tintas` → "Loja Coral". Derivar do slug erra ~10% (4/40 na amostra).
  **Nome canônico sai do `ld+json` `@type:Store` da página da loja** (`src/mel-store-page.ts`, 40/40 na
  amostra), junto com o logo (40/40 via `.hero-sec__logo img`). Como o adapter já visita todas as 664
  páginas 2×/dia, nome e logo saem de graça — não precisa de crawl extra.

→ **Plano méliuz v1 (crawl tiered):** tier ativo 664 lojas → 2×/dia (~1330 req/dia, ~17 min a 1,5s);
tier inativo 1687 cupom-only → 1×/5 dias fatiado (~337/dia) p/ flagrar quem ganhou cashback.
~1670 req/dia sem rajada, vs 4710/dia se buscasse tudo 2×. Custo: cauda que ganha cashback aparece em ≤5 dias.

### 5. Zoom: anti-bot não bloqueou — e o DOM só mostra 24 das 212 lojas

`--live` rodado em 09/07/2026 (máquina local). **`fetch` com os headers do `shared.ts` passou** — HTTP 200,
570 KB. Sem Playwright, sem Cloudflare. (O bloqueio do recon era de IP datacenter; **falta confirmar do
GitHub Actions** — ver Pendências.)

O parser antigo devolvia **20 ofertas e parecia saudável** — mas era uma armadilha. O diretório é Next.js
App Router e o HTML servido só renderiza **24 cards**; as outras 188 lojas chegam na hidratação do payload
RSC. Um `[data-testid="coupon-seller-card"]` conta 24, enquanto o header da página diz **"212 lojas
encontradas"**. O parser DOM perdia **88% do diretório em silêncio**.

**Fonte da verdade = o array `sellers` embutido em `self.__next_f`** (23 chunks concatenados; recorte por
balanceamento de colchetes a partir de `"sellers":[`). **212 lojas em 1 request.**
`?page=2` / `?pagina=2` são **ignorados pelo servidor** (mesmas 212) → **não há paginação**.

Shape (fixture: `fixtures/zoom-sellers.json`):

```json
{ "id":"5", "name":"Fast Shop", "countOfCoupons":1,
  "cashbackModality": { "allMerchant":0.06, "bestFormula":0.06,
                        "offerRates":{"min":0.06,"max":0.06},
                        "categories":[], "categoryRates":null, "merchantId":5 },
  "paths": { "homePage":"/cupom-de-desconto/fast-shop-5" },
  "logoUrls": { "mediumRoundend":"…200x200.png" } }
```

As duas regras foram lidas do bundle (`page-f0ab…js` + módulo `28487` em `19933-…js`), não adivinhadas:

- **Ativa ⇔ `bestFormula > 0`.** `allMerchant` **não** serve de gate: a **Continental** tem
  `allMerchant:null` mas `bestFormula:0.01` — filtrar por `allMerchant` a derrubaria. Não existe
  `bestFormula: 0` (inativa = `null`), então não há a armadilha do `fullCashbackValue:0` do inter.
  Inativas: **41** (Amazon, Magazine Luiza, Carrefour, Netshoes, Nike…) — o card mostra `"Sem Cashback"`.
- **`is_upto` ⇔ `hasMultipleCashback()`**: conta as taxas **positivas** em
  `[allMerchant, offerRates.min, offerRates.max, ...categories[].cashbackRate]` e liga o "até" se houver
  **mais de uma**. Repare que **não** compara `min ≠ max`: a Fast Shop tem `allMerchant=min=max=0,06`
  (3 positivos) e exibe **"até 6% de volta"**. Hoje é a **única** loja com "até" nas 212.
  (`categoryRates` não entra na conta — quem entra é `categories[].cashbackRate`; ambos vazios hoje.)
- Valor exibido = `bestFormula` formatado: se `< 1`, ×100; `format("0.0")` e corta `.0` final.
  `0.005 → "0.5%"`, `0.06 → "6%"`. O adapter usa o **float cru**, não o texto (o `×100` gera ruído
  binário — `0.06*100 = 6.000000000000001` — daí o `toFixed(4)` no `toPercent`).

Port das duas funções + parser reproduzem **24/24** os cards renderizados. Resultado: **171 ofertas**
(faixa 0,5%–20%; `<1%`:28 · `1–3%`:43 · `3–5%`:44 · `5–10%`:52 · `10%+`:4).

Outras notas:

- **Zoom não tem boost.** Nenhuma chave `previous`/`old`/`era` no shape — ao contrário de inter
  (`previousCashback`) e cuponomia (`del.rewardsTag-previous`). `previousRewardText` fica sempre vazio.
- **Nenhum valor em R$** — `bestFormula` é sempre fração (0 < x < 1). Só % nas 212.
- `paths.homePage` já traz a URL da loja (nenhuma nula). O card monta o href com um slugify
  `nome+id`, mas `paths.homePage` é dado — preferir o dado.
- Cross-check barato por run: `"N lojas encontradas"` do HTML **deve** bater com `sellers.length`.
  Divergiu, o flight mudou → não gravar.
- Se um dia o RSC sumir, o DOM tem `data-testid` estáveis (`coupon-seller-card`,
  `::seller-name`, `::cashback`) — melhores que os prefixos de classe com hash. Mas só renderizam 24.

---

## 6. Normalização de nomes (`src/normalize.ts`)

Dataset real: 1853 nomes (inter 374 · zoom 212 · mycashback 468 · cuponomia 799 — os 4 sites que expõem
nome completo). Méliuz entra só com amostra: **o dataset dele não guarda nome** (ver §7).

**Métrica de segurança = colisão intra-site.** Se dois nomes distintos do *mesmo* portal colapsam na mesma
chave, a regra está agressiva demais (nenhum portal lista a mesma loja duas vezes). Isso importa porque os
dois erros não são simétricos: **um merge falso mostra o cashback ERRADO** (Disney+ herdando a taxa da
Disney Store); um merge perdido só deixa de comparar. Logo: chave conservadora + tabela de alias curada.

| nível | regra | chaves | ≥2 sites | colisões |
|---|---|---|---|---|
| L0 | lowercase | 1121 | 433 | 0 |
| L1 | + sem acento/pontuação/domínio, `+`→`plus` | 1091 | 439 | 0 |
| **L2 ✅** | **+ junta tokens (sem espaço)** | **1063** | **443** | **0** |
| L3 ❌ | + remove decorador (`loja/store/shop/br…`) | 1026 | 454 | 0* |

**L2 é a chave.** L3 parece melhor (+11 matches) e é uma armadilha:

- L3 **quebra** `Fast Shop` × `Fastshop` → `"fast"` vs `"fastshop"` (removeu `shop`, que ali é **marca**).
- O `0*` de colisão do L3 é **sorte deste dataset**: sem o `+`→`plus` do L1, `Disney+` e `Disney Store`
  colapsam ambos em `"disney"`. Um portal listar só `Disney` já refaz o merge falso.
- `Shop`/`Store` é marca numa loja e enfeite noutra. Nenhuma lista de palavras resolve isso.

L2 resolve de graça: `Fast Shop`×`Fastshop`, `123 Milhas`×`123milhas`, `Casas Bahia`×`casasbahia.com.br`.
E mantém separados `Disney+`≠`Disney Store` e `Nike`≠`Nike Store`.

⚠️ **Regex + acento**: `/\bat[ée]\b/i` dá **false** em `"Ativar até 10%"` — `é` não é word-char em JS, então
`\b` não dispara depois dele. **Tirar o acento antes** de usar limite de palavra. (`mel-crawl.ts` escapou por
usar `/até/i` sem `\b`.)

### O resto vira `store_aliases` (curado, não automático)

L3 + Levenshtein viram **gerador de candidatos**, nunca chave. Saída: `fixtures/alias-candidates.json`,
**45 pares cross-site** (41 decorador + 4 levenshtein) — revisão humana de uma tacada só:

- decorador (todos verdadeiros): `nike`~`nikestore` · `renner`~`lojasrenner` · `lg`~`lojaonlinelg` ·
  `dji`~`lojadjibrasil` · `shopee`~`shopeebrasil` · `claroloja`~`lojaclaro` (ordem invertida!)
- levenshtein: 3 são plural (`drogariapacheco`~`drogariaspacheco`, `farmaciasaojoao`~`farmaciassaojoao`,
  `drogariatamoio`~`drogariastamoio`); **1 exige olho humano**: `discovercars`~`discoverycars` (0,92) —
  ou é typo de um portal, ou são empresas distintas. É exatamente para isso que a fila de revisão existe.
- **Clusters transitivos existem**: `brinox` ~ `brinoxshop` ~ `lojaoficialbrinox`. O alias precisa apontar
  para um `store_id` canônico (union-find), não ser par a par.

**Métrica de produto (4 sites):** 1063 lojas canônicas, **443 comparáveis (≥2 portais, 42%)**, 620 num portal
só. Ou seja: a maioria das lojas não tem com quem comparar — a UI precisa tratar "só 1 portal tem" como caso
normal, não como erro.

## 7. Logos e ícones (`src/assets.ts`)

Origens (1 logo por loja, em CDN próprio de cada portal):

| site | host | tipo | peso | cache-control | logo em |
|---|---|---|---|---|---|
| inter | `marketplace.bancointer.com.br` | `application/octet-stream` ⚠️ | 40,7 KB | — | `imageUrl` |
| zoom | `s.zst.com.br` | `binary/octet-stream` ⚠️ | 6,6 KB | `max-age=86400` | `logoUrls.mediumRoundend` (200×200) |
| mycashback | `www.mycashback.com.br` | `webp` | 3,8 KB | — | **`data-src`** (250×80, banner) |
| cuponomia | `assets.cuponomia.com.br` | `png` | 2,5 KB | `max-age=86400` | `.store_header img` |
| méliuz | `s.staticz.com.br` | `png` | 7,2 KB | **`private`** ⚠️ | `.hero-sec__logo img` |

- 🐛 **mycashback: 468/468 logos eram `/img/noimage.jpg`.** É lazysizes — o `src` é placeholder e o logo
  real está em `data-src` (`…/w250h80q80fit.png.webp`). O parser antigo gravava o placeholder para **toda**
  loja. Corrigido em `mycashback.ts`.
- **Nenhum dos 5 bloqueia hotlink** — todos devolvem 200 com `Referer` de terceiro. Funciona hoje.
- **Mesmo assim: auto-hospedar.** Hotlink é um `Referer`-rule de distância de quebrar **todos** os logos de
  uma vez, e falha em silêncio (imagem quebrada). Além disso: inter e zoom mandam `octet-stream` (o
  `next/image` recusa e o browser adivinha), inter não manda `cache-control`, e o méliuz manda `private`
  (nenhum CDN/proxy cacheia). E puxar banda do portal que estamos comparando é hostil — é o tipo de coisa
  que faz eles bloquearem.
- **Custo medido de auto-hospedar**: média real de 4,2 KB/logo (amostra de 8, zoom 200×200) →
  **~1063 lojas ≈ 4,4 MB**. Irrelevante contra o free tier do Supabase Storage (~1 GB — conferir limite atual).
- **Aspecto varia**: zoom é quadrado 200×200, mycashback é **banner 250×80**. Normalizar para quadrado
  (webp, ~128 px) na ingestão; preferir fontes quadradas (zoom > méliuz > cuponomia) e usar mycashback só
  como fallback.
- **1 logo por loja canônica**, não por oferta → 1063 arquivos, não 1853.
- **Cadência à parte do scrape.** Logo quase nunca muda: job semanal (ou por ETag/hash), não 2×/dia.
  Guardar `logo_hash` para não re-subir igual.
- **Fallback sem logo**: avatar com a inicial do nome. O próprio zoom faz isso (componente recebe `url` + `name`).
- **Ícones dos 5 portais** (Méliuz, Cuponomia, MyCashback, Zoom, Inter): são **5 assets fixos** — versionar
  no repo (`apps/web/public/portals/*.svg`), não raspar. Uso nominativo p/ comparação; não alterar as marcas
  nem sugerir endosso.

---

## Aprendizados que continuam válidos

1. **Cuponomia é o mais robusto de parsear**: data-attributes de máquina no `.store_header`
   (`data-store-name`, `data-cashback-displayed`, `data-store-cashback-actual`) — não dependem de layout.
2. Inter usa `data-testid` (`store-card`, `store-url`) — mas isso só importa se um dia formos por DOM;
   hoje a API JSON torna o parser HTML desnecessário.
3. Zoom e Inter usam classes com hash (CSS modules / styled-components) — se algum dia for por DOM,
   selecionar por `[data-testid]` (existe nos dois) e, na falta dele, por `[class*="Prefixo_Semantico"]`,
   nunca pela classe completa. ⚠️ No zoom o prefixo `CouponSellerCard_Cashback` casa **dois** nós aninhados
   (`_Cashback__` e `_CashbackDefault__`) — outro motivo para não ir de DOM.
4. **Formatos de valor a cobrir no `parseReward`** (todos observados em produção):
   `7% Cashback` · `Até 11% Cashback` · `até 3%` · `Até* 20%` (asterisco) · `3.5%` (ponto) ·
   `4,5%` (vírgula) · `12% de cashback` · `0.5% de volta` · `Zoom te devolve 0.5% do valor` ·
   **`R$ 8,5 de cashback`** (cuponomia/sams-club).
5. **Boost nativo**: cuponomia = `<del class="rewardsTag-previous">(era 1%)</del>`;
   méliuz = `(era X%)` no texto do card; inter = campo `previousCashback` da API.
   Uma regex `/\(?era\s+([\d.,]+\s*%)\)?/i` cobre os dois primeiros — desde que aplicada ao
   **elemento certo**, nunca ao texto do container inteiro. **Zoom não tem boost** (sem campo no shape).
6. **Inativas**: mycashback = `.cbDetails` com texto `"Sem  Cashback"` (**não** ausência do elemento);
   zoom = `cashbackModality.bestFormula: null` (o `"Sem Cashback"` é texto **derivado** no card, não o sinal);
   cuponomia = `data-cashback-displayed` vazio; inter = `fullCashbackValue: 0` (`"Ofertas disponíveis"`).
   Nos quatro casos o parser não emite a oferta (F8).
8. **Dois sites entregam JSON, não HTML**: inter (API pública) e zoom (payload RSC embutido). Nos dois, o
   HTML servido **mente** — o do inter tem 0 cards, o do zoom tem 24 de 212. Um parser de DOM que "funciona"
   nesses sites está silenciosamente errado. Antes de confiar numa contagem, cruze com um número que o
   próprio site declara (`pagination.total`, `"N lojas encontradas"`).
9. **`HTTP 200` não significa "a página que eu pedi".** O cuponomia serve a home com 200 quando estrangula
   (17% do 1º crawl). Todo parser de página de loja precisa de um **sinal de presença** (`.store_header`,
   `.hero-sec`, `data-store-name`) e tratar a ausência dele como **erro retentável**, nunca como
   "loja sem cashback". Falhar assim é pior que cair: vira ativa→inativa, some com a oferta, e o total
   de lojas nem muda — o sanity check precisa olhar a **queda de ofertas ativas**.
10. **`data-*` de exibição carregam o "até"**: o cuponomia põe `"até 4%"` dentro de
   `data-cashback-displayed`. Nunca passe um atributo "de valor" direto pro `parseFloat` — normalize antes.
7. **Nomes divergem entre sites** (Nike × Nike Store; Fast Shop × Fastshop; slug méliuz
   `cupom-de-desconto-nike` × `cupom-magazine-luiza` — o prefixo do slug **não** é uniforme) —
   confirma a necessidade da tabela `store_aliases`.

---

## Fixtures

⚠️ **Migrado (T1, ADR-0002):** as fixtures integrais e os datasets abaixo agora vivem em
`packages/test-fixtures/fixtures/` (loader: `fixturePath()`/`loadFixture()`). `docs/poc/fixtures/`
mantém só os `.sample.html` anotados. Os scripts deste POC que liam/escreviam em `../fixtures/*`
(`cup-crawl`, `cup-analyze`, `mel-crawl`, `mel-analyze`, `mel-dataset`, `mel-recon`,
`mel-store-page`, `normalize`, `assets`) são **histórico arquivado** — não rodam mais sem apontar
para o novo caminho. Os testes de contrato reais leem de `packages/test-fixtures`.

Integrais capturadas no `--live` (09/07/2026), agora em `packages/test-fixtures/fixtures/`:

| Arquivo | Conteúdo |
|---|---|
| `inter-stores.api.json` | resposta da API, 374 lojas ← **fonte real do inter** |
| `inter-lojas.html` | shell client-side, 0 cards (serve p/ testar que o HTML **não** basta) |
| `mycashback-all-shops.html` | 468 cards, 7 com "Sem  Cashback" |
| `cuponomia-desconto.html` | diretório, 799 slugs |
| `cuponomia-loja-exemplo.html` | `123milhas` — sem cashback (`data-cashback-displayed=""`) |
| `cuponomia-loja-boost.html` | `iplace` — super cashback, `(era 1%)` |
| `cuponomia-loja-brl.html` | `sams-club` — valor em `R$ 8,5` |
| `meliuz-categoria.html` | categoria `moda-e-acessorios` |
| `meliuz-desconto.html` | diretório, ~2355 lojas, sem valores (cards só logo+link) |
| `meliuz-loja.html` | `cupom-magazine-luiza` — cashback em `.hero-sec__redirect-btn button` |
| `meliuz-crawl.jsonl` | crawl das 2355 lojas: 664 com cashback, 1687 cupom-only, 4 fora |
| `meliuz-active-stores.json` | dataset limpo: 664 lojas ativas com valor (% e R$) |
| `zoom-lojas.html` | diretório: 24 cards no DOM, **212 lojas no payload RSC** |
| `zoom-sellers.json` | array `sellers` extraído do RSC, 212 lojas ← **fonte real do zoom** |
| `meliuz-store-sample.json` | 40 páginas de loja: nome (ld+json) + logo + valor (12 em R$) |
| `alias-candidates.json` | 45 pares cross-site p/ revisão humana → `store_aliases` |
| `cuponomia-crawl.jsonl` | crawl das 799: 798 páginas, 524 com cashback, 1 slug morto |
| `cuponomia-active-stores.json` | dataset limpo: 524 lojas ativas (509 `%` + 15 `R$`) |

As `.sample.html` são reconstruções parciais e **não são confiáveis** (a do inter descreve um DOM que o
fetch nunca devolve; a do mycashback erra o caso inativo; a do zoom não tem payload RSC, então o parser
novo devolve 0 nela). Substituir pelas integrais nos testes de contrato — `zoom.ts` offline já lê a
integral `zoom-lojas.html`.

## Pendências

- [x] **Zoom**: `--live` ok — fetch com headers **passa** o anti-bot (local); **sem paginação** (212 lojas em
      1 request, via payload RSC). `zoom.ts` reescrito para ler o `sellers` do flight: **171 ofertas**.
- [ ] **Zoom / CI**: confirmar que o IP do **GitHub Actions** também passa o anti-bot (o recon só viu bloqueio
      de datacenter). Se bloquear, o `parseZoomSellers` continua valendo sobre o `page.content()` do Playwright.
- [ ] **Zoom / boost**: nenhuma loja em "até" além da Fast Shop, e nenhum campo de valor anterior. Reconferir
      numa 2ª coleta se `offerRates`/`categories` aparecem preenchidos noutras lojas (a regra do "até" está
      validada por n=1 no DOM, mas o port veio do bundle, não de amostra).
- [x] **Méliuz**: seletor resolvido (`.hero-sec__redirect-btn button` + `strong[data-main]`); API privada descartada; **crawl completo = 664 lojas ativas** (72% do diretório é cupom-only); 42 pagam R$ fixo; v1 = crawl tiered. Falta escrever o adapter de página de loja (parsear % **e** R$ do botão do hero).
- [ ] **Inter**: reescrever `inter.ts` para consumir a API JSON.
- [ ] **MyCashback**: filtrar `"Sem  Cashback"`. (logo via `data-src` ✅ corrigido)
- [x] **Cuponomia**: regex de boost trocada por `del.rewardsTag-previous`; `R$` suportado; `"até X%"` no
      `data-cashback-displayed` tratado; soft-block detectado e retentado.
- [x] Confirmar se `data-store-cashback-actual` prefixa "até" quando `data-should-use-up-to=true` →
      **sim, 28/28** (o diretório inteiro tem 28 lojas com a flag).
- [x] **Cuponomia**: crawl completo das 799 → **524 com cashback** (a extrapolação de ~479 errava p/ menos).
- [ ] **Aliases**: revisar à mão os 45 pares de `alias-candidates.json` (atenção ao
      `discovercars`~`discoverycars`) e decidir o `store_id` canônico de cada cluster.
- [ ] **Logos**: escrever o job de ingestão (baixar → webp quadrado 128px → Supabase Storage → `logo_hash`).
