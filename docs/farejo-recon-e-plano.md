# farejô — Recon dos sites + Plano de implementação

Recon executado em 09/07/2026, testando (a) fetch HTTP simples e anônimo a partir de IP de datacenter — o mesmo perfil de rede do GitHub Actions — e (b) inspeção via browser (DOM, network, área não logada).

## Resultado principal

**4 dos 5 sites dispensam Playwright.** Méliuz, Cuponomia, MyCashback e Inter são server-side rendered e respondem a fetch anônimo com os valores no HTML — adapter = `fetch + cheerio`. **Zoom é o único que exige Playwright**: o HTML chega vazio sem JavaScript (client-side rendering), mas o valor por loja existe e é visível deslogado.

## Ficha por site

### 1. shopping.inter.co — dificuldade: ★☆☆☆

| Aspecto | Achado |
|---|---|
| Acesso anônimo | ✅ SSR (Next.js), fetch simples funciona |
| Fonte dos dados | `/site-parceiro/lojas?category=ALL-STORES` — **uma página, já ordenada por cashback** |
| Formato dos valores | `18% de Cashback`, `Até 15% de cashback` |
| Boost | ✅ exibe valor anterior (`Era 10%`) |
| Custo por run | ~1 request |
| Atenção | % exibido é para correntistas; não correntistas recebem ~70% do valor (regra fixa do FAQ — dá para exibir ambos). Categoria via query param se quisermos categorizar |

### 2. mycashback.com.br — dificuldade: ★☆☆☆

| Aspecto | Achado |
|---|---|
| Acesso anônimo | ✅ SSR clássico, fetch simples funciona |
| Fonte dos dados | `/all-shops` — diretório com nome + valor no mesmo HTML |
| Formato dos valores | `7% Cashback`, `Até 11% Cashback`, `até 3%` (capitalização inconsistente — parser case-insensitive) |
| Boost | não observado |
| Custo por run | ~1–5 requests (verificar paginação do all-shops) |
| Atenção | inativo = card sem valor parseável → não emitir oferta |

### 3. meliuz.com.br — dificuldade: ★★☆☆

| Aspecto | Achado |
|---|---|
| Acesso anônimo | ✅ SSR, fetch simples funciona (o 404 inicial era URL errada: a listagem é `/desconto`, não `/lojas`) |
| Fonte dos dados | Diretório `/desconto`: **2.395 lojas** (nome+slug+logo, SEM valores). Categorias `/cupom/<cat>` (~21): cards com valores. Página da loja `/desconto/<slug>`: valor confiável (`+ 2% cashback`) |
| Formato dos valores | `3% de cashback`, `8% de cashback (era 3%)` |
| Boost | ✅ `(era X%)` no próprio card |
| Estratégia | v1: categorias (top ~200–300 lojas com valores, 21 requests). v2: crawl incremental das páginas de loja do diretório (2.395 requests espaçados — viável, ~40 min/run com delay de 1s, ou fatiado entre runs) |
| Atenção | slugs do diretório vs categoria divergem (`/desconto/nike` redireciona para `/desconto/cupom-de-desconto-nike`) — normalizar pelo destino final |

### 4. cuponomia.com.br — dificuldade: ★★☆☆

| Aspecto | Achado |
|---|---|
| Acesso anônimo | ✅ SSR, fetch simples funciona |
| Fonte dos dados | Diretório `/desconto`: **799 lojas** (sem valores). Valor na página da loja: `Ativar 9% de cashback (era 2%)` — visível deslogado |
| Boost | ✅ "Super cashback" com valor anterior riscado e **countdown de expiração** |
| Estratégia | diretório → 799 páginas de loja por run. Com delay de 1s ≈ 15 min — cabe com folga no GitHub Actions |
| Atenção | recon no browser estava logado; validei deslogado via fetch anônimo e o valor aparece igual. Card "super cashback" tem markup próprio — fixture dedicado |

### 5. zoom.com.br — dificuldade: ★★★☆ (o único que precisa de Playwright)

| Aspecto | Achado |
|---|---|
| Acesso anônimo | ⚠️ Valores visíveis deslogado, mas **fetch simples retorna HTML vazio** (client-side rendering) → Playwright obrigatório |
| Fonte dos dados | Diretório `/cupom-de-desconto/lojas` (cards indicam quem tem cashback vs `Sem Cashback`). Valor na página da loja `/cupom-de-desconto/<slug>-<id>`: `Zoom te devolve 0.5% do valor` |
| Formato dos valores | `Zoom te devolve X% do valor` — frase própria, parser dedicado |
| Boost | não observado |
| Estratégia | Playwright: diretório (filtrando `Sem Cashback`) → páginas de loja. Nº total de lojas a confirmar no POC (diretório mostrou 32 cards inicialmente — verificar paginação/lazy load) |
| Atenção | slugs carregam id numérico (`boticario-21711`) — guardar URL completa no alias. Achado técnico: é Next.js App Router com RSC streaming — **os dados de cashback estão embutidos no HTML inicial** (chunks `self.__next_f`), não vêm de XHR. O fetch vazio do teste foi bloqueio de bot (IP de datacenter/UA), não client-rendering puro. POC decide: fetch com headers de browser (parseando os chunks RSC) vs Playwright |

## Descobertas transversais

1. **Boost é dado nativo em 3 dos 4 sites** (`era X%`) — além do histórico próprio (`offer_history`), o v1 já pode exibir boost desde o primeiro scrape, sem esperar acumular dados. Adicionar campo `previous_value numeric null` em `offers` e `RawOffer.previousRewardText?`.
2. **Área não logada é suficiente em todos** — nenhum valor exigiu login. O Inter tem a nuance correntista/não correntista (regra de 70%), que viramos feature: toggle "sou correntista Inter".
3. **Nenhum endpoint JSON interno encontrado** — os sites são SSR clássico; o HTML é a API. Fixtures de contrato se tornam ainda mais importantes.
4. **Volume por run** (delays de 1s incluídos): inter ~1 req · mycashback ~5 · méliuz ~25 (v1) · cuponomia ~800 · zoom ~N lojas via Playwright (confirmar N no POC) ≈ **20–30 min/run total**, 2×/dia. Confortável no free tier.

## Impacto no design original

| Item do design | Mudança |
|---|---|
| Playwright como base | ↓ só o zoom precisa; os outros 4 usam `fetch` nativo + cheerio |
| `offers` | + coluna `previous_value` (boost nativo dos sites) |
| Runtime do scraper | mais simples e mais rápido que o previsto |

## Plano de implementação (POCs primeiro, como você propôs)

**Fase 0 — POC descartável (1 sessão):** um script por site (`poc/meliuz.ts`, etc.) que faz fetch, parseia e imprime `RawOffer[]` no console. Sem banco, sem pipeline. Objetivo: validar seletores e salvar o HTML real como fixture. Para o zoom: primeiro investigar (via DevTools/network) se a hidratação vem de endpoint JSON interno; só cair para Playwright se não vier. *Critério de saída: os 5 POCs imprimindo lojas+valores corretos.*

**Fase 1 — esqueleto (1–2 sessões):** monorepo pnpm (`apps/scraper`, `apps/web`, `packages/shared`), tipos + contrato `SiteAdapter`, pipeline (zod → parse de valor → upsert), Supabase com o schema do design doc, migrar os 2 POCs fáceis (inter, mycashback) para adapters com testes de fixture.

**Fase 2 — adapters restantes (2 sessões):** méliuz (categorias) e cuponomia (diretório → páginas) com rate limiting; zoom com Playwright (ou endpoint JSON, se o POC encontrar); sanity checks, `offer_history` delta-based, GitHub Actions com cron 12h + alerta Telegram.

**Fase 3 — normalização + frontend (2–3 sessões):** aliases/fuzzy match com os dados reais das 4 fontes, Next.js (busca, ranking, card, página da loja com calculadora e badge de boost), deploy Vercel.

**Fase 4 — polish:** admin de aliases, gráfico de histórico (quando houver dados), crawl completo do méliuz.

Ordem dos POCs: **inter → mycashback → cuponomia → méliuz → zoom** (do mais trivial ao que tem mais decisões; zoom por último por ser o único com browser/JS).
