# farejô — System Design

Comparador de cashback brasileiro (inspirado em [reward.ist](https://www.reward.ist/)). Dada uma loja (ex.: Nike), mostra qual plataforma — Méliuz, Cuponomia, MyCashback, Zoom ou Shopping Inter — oferece o maior retorno, com redirecionamento para a plataforma escolhida.

**Veredito de viabilidade: sim, viável.** O reward.ist prova o modelo (mesma ideia, várias plataformas australianas, mantido por 1 pessoa, gratuito). O volume de dados é pequeno, o refresh de 12h é folgado, e todo o stack cabe em free tiers. O risco concentrado é a **fragilidade dos scrapers** — e o design abaixo é construído em torno de mitigar isso.

---

## 1. Requisitos

### Funcionais

| # | Requisito |
|---|-----------|
| F1 | Busca por loja específica (ex.: "Nike"), tolerante a variações de nome |
| F2 | Catálogo completo, com ordem padrão por cobertura e alternativas por maior cashback e A–Z |
| F3 | Paginação da listagem |
| F4 | Card da loja com até 3 ofertas + `+N`/"ver todas" |
| F5 | Página dedicada por loja com todas as ofertas |
| F6 | Redirecionamento para a página da loja na plataforma de cashback |
| F7 | Atualização dos dados a cada 12h |
| F8 | Não listar no catálogo lojas sem oferta pública elegível; preservar a rota canônica indisponível |
| F9 | Histórico de ofertas: gráfico de variação por loja e detecção de "boosts" (oferta acima do normal) |
| F10 | Páginas públicas `/plataformas`, `/como-funciona` e `/faq`, sem login |

### Não funcionais

| Categoria | Requisito |
|-----------|-----------|
| Custo | R$ 0/mês (free tiers apenas) |
| Escala | Uso pessoal; < 100 usuários; ~10–25 mil ofertas no banco |
| Disponibilidade | Best-effort; até 24h normal, 24–48h marcado como atrasado, acima de 48h fora das superfícies públicas |
| Manutenibilidade | **Requisito nº 1.** Quebra de scraper deve ser detectada automaticamente e o conserto deve ser localizado (1 arquivo por site) |
| Latência | Páginas preferencialmente em cache; ativação com p95 < 500 ms e timeout total de 1,5 s |
| Segurança | Banco nunca acessado pelo navegador; privilégio mínimo por role e nenhuma `service_role` na Vercel |

### Restrições e premissas

- Sites-alvo sem API pública; alguns são SPAs (renderização via JS) e podem ter anti-bot (Cloudflare etc.).
- Estruturas de HTML diferentes entre si e mutáveis ao longo do tempo.
- Formatos de cashback heterogêneos: `7%`, `R$ 15`, "até 8%".
- Mesma loja com nomes diferentes entre plataformas ("Nike", "Nike BR", "nike.com.br").
- Stack: **Node/TypeScript** em todo o sistema. Sem browser automation no caminho principal (validado: os 5 sites servem os dados via HTML SSR, API JSON aberta ou payload RSC).

---

## 2. Arquitetura de alto nível

```
┌──────────────────────────── GitHub Actions (cron 12h) ────────────────────────────┐
│                                                                                    │
│   scraper (Node/TS — fetch puro; sem browser)                                      │
│   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│   │  adapter  │ │  adapter  │ │  adapter  │ │  adapter  │ │  adapter  │           │
│   │  méliuz   │ │ cuponomia │ │mycashback │ │   zoom    │ │   inter   │           │
│   └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘           │
│         └─────────────┴───────┬─────┴─────────────┴─────────────┘                 │
│                               ▼                                                    │
│              pipeline compartilhado (validação zod → parse de                     │
│              valor → normalização de loja → sanity check → upsert)                │
└───────────────────────────────┬────────────────────────────────────────────────────┘
                                ▼
                     ┌─────────────────────┐
                     │  Supabase Postgres  │  (free tier, 500 MB)
                     │  stores / offers /  │
                     │  aliases / runs     │
                     └──────────┬──────────┘
                                ▼
                     ┌─────────────────────┐
                     │  Next.js na Vercel  │  (hobby, grátis)
                     │  SSR/ISR + busca,   │
                     │  listagem, loja     │
                     └─────────────────────┘
```

**Três repositórios ou um monorepo?** O projeto usa **monorepo** (pnpm workspaces): `apps/scraper`, `apps/web`, `packages/shared` e `packages/test-fixtures`. Não existe backend público separado. Server Components e Route Handlers do Next.js consultam views restritas no Postgres; o navegador recebe apenas DTOs de apresentação.

### Escolhas e alternativas

| Decisão | Escolha | Alternativa rejeitada | Por quê |
|---------|---------|-----------------------|---------|
| Execução do scraper | GitHub Actions cron | VPS grátis (Oracle), Raspberry local | Zero infra, cron nativo, logs e alertas de falha grátis, Playwright já suportado. Repo público = minutos ilimitados |
| Banco | Postgres (Supabase ou Neon, equivalentes) | NoSQL (Mongo Atlas, Firestore); SQLite/Turso | O domínio é relacional: joins (oferta→loja→alias), ranking paginado, mediana p/ boost e busca fuzzy (`pg_trgm`) são queries triviais em SQL; em NoSQL viram lógica na aplicação sem ganho em troca (schema é estável, volume é minúsculo). Supabase ganha pelo dashboard (revisão de aliases); trocar p/ Neon depois = mudar a connection string |
| Frontend/API | Next.js App Router + Vercel, leitura PostgreSQL server-only | SPA + PostgREST/Data API no browser | Cache e SSR sem expor credencial, schema operacional ou cota de consulta; rotas internas só quando justificadas |
| Fonte de dados por site (validado no `--live` de 09/07/2026) | **inter**: API JSON pública sem auth (`marketplace-api.web.bancointer.com.br`, 1 req) · **zoom**: JSON embutido no payload RSC do HTML (1 req) · **mycashback/cuponomia/méliuz**: `fetch + cheerio` | Playwright | Nenhum site precisa de browser. Playwright vira plano B documentado (só se o IP do GitHub Actions for bloqueado) — os parsers rodam iguais sobre `page.content()` |

> **Lição do recon (vale para plataformas futuras):** o HTML servido mente. Inter devolve shell vazio (parser DOM "passava" com 0 lojas na fixture reconstruída); zoom renderiza 24 cards, mas embute 212 no flight RSC (parser DOM devolvia 20 *parecendo saudável*). Antes de raspar DOM: (1) procure endpoint JSON no DevTools, (2) procure dados embutidos (`__NEXT_DATA__`, `self.__next_f`), (3) **sempre cruze a contagem com um total declarado pelo site** (`pagination.total`, "N lojas encontradas"). A API privada do méliuz (OAuth com secret no bundle) foi descartada — só endpoints abertos ou HTML público.

---

## 3. Modelo de dados

> **Precedência:** o SQL abaixo descreve o modelo conceitual original. `supabase/migrations/` é a
> fonte da verdade do schema já aplicado; ADRs 0006–0053 definem os deltas aprovados para a Fase 3,
> que só passam a existir no banco por novas migrations.

```sql
-- Plataformas (seed fixo: meliuz, cuponomia, mycashback, zoom, inter)
create table platforms (
  id          text primary key,          -- 'meliuz'
  name        text not null,             -- 'Méliuz'
  base_url    text not null
);

-- Loja canônica (a entidade que o usuário vê)
create table stores (
  id          bigint generated always as identity primary key,
  slug        text unique not null,      -- 'nike'
  name        text not null,             -- 'Nike'
  logo_url    text,                      -- URL no NOSSO Supabase Storage (auto-hospedado; ver §6.1)
  logo_hash   text,                      -- hash do binário: job de logos só re-sobe se mudou
  created_at  timestamptz default now()
);

-- Mapa de normalização: nome cru na plataforma → loja canônica
create table store_aliases (
  platform_id     text references platforms(id),
  raw_name    text not null,             -- 'Nike BR'
  store_id    bigint references stores(id),
  confidence  text not null default 'auto',  -- coluna legada; decisões humanas passam a vir do Git
  primary key (platform_id, raw_name)
);

-- Oferta vigente (1 por loja+plataforma; histórico opcional em offer_history)
create table offers (
  store_id      bigint references stores(id),
  platform_id       text references platforms(id),
  reward_type   text not null,           -- 'percent' | 'fixed'
  value         numeric(10,2) not null,  -- 7.00 (%) ou 15.00 (R$)
  value_partial numeric(10,2),           -- inter: valor não-correntista (~0.7×); null nas demais plataformas
  is_upto       boolean default false,   -- "até 8%"
  raw_text      text not null,           -- o texto original, para debug
  url           text not null,           -- link de redirecionamento na plataforma
  active        boolean default true,
  last_seen_at  timestamptz not null,
  updated_at    timestamptz default now(),
  primary key (store_id, platform_id)
);

-- Histórico: 1 linha POR MUDANÇA de valor, não por run (ver nota abaixo)
create table offer_history (
  id            bigint generated always as identity primary key,
  store_id      bigint not null,
  platform_id       text references platforms(id),
  reward_type   text not null,
  value         numeric(10,2),             -- null = oferta desativada nesse momento
  is_upto       boolean default false,
  changed_at    timestamptz not null default now(),
  foreign key (store_id, platform_id) references offers(store_id, platform_id)
);

create index idx_history_store on offer_history (store_id, platform_id, changed_at desc);

-- Auditoria de execução (a base do sistema de alertas)
create table scrape_runs (
  id            bigint generated always as identity primary key,
  platform_id       text references platforms(id),
  started_at    timestamptz not null,
  finished_at   timestamptz,
  status        text not null,           -- 'ok' | 'failed' | 'suspicious'
  offers_found  int,
  active_offers int,                     -- ⚠️ métrica vigiada: soft-block derruba ISSO, não o total
  parse_errors  int,
  soft_blocks   int default 0,           -- respostas 200-sem-página (retentadas)
  notes         text
);

-- Estado de crawl por slug (méliuz tiered e cuponomia página-a-página):
-- torna crawls RETOMÁVEIS e permite fatiar a cauda entre runs.
create table crawl_state (
  platform_id         text references platforms(id),
  slug            text not null,
  tier            text not null default 'active',  -- 'active' (2×/dia) | 'tail' (1×/5 dias, fatiado)
  last_checked_at timestamptz,
  last_outcome    text,                  -- 'offer' | 'no_cashback' | 'not_found' | 'soft_block'
  primary key (platform_id, slug)
);

create index idx_offers_active on offers (active, value desc);
create index idx_stores_name_trgm on stores using gin (name gin_trgm_ops); -- busca fuzzy
```

Pontos de design:

- **`offers` guarda só o estado vigente** (PK composta loja+plataforma, upsert). Toda query do dia a dia (busca, ranking, card) bate só nela — o histórico nunca entra no caminho quente.
- **`offer_history` é delta-based: grava apenas quando o valor muda**, não a cada run. Primeiro-visto, mudança, desativação e reativação criam eventos; re-run idempotente só atualiza frescor. A Fase 3 acrescenta `value_partial` nullable ao histórico para que o toggle Inter selecione uma série verdadeira de não-correntista. Escrita continua atômica por plataforma e por escopo; runs `suspicious`/`failed` não alteram ofertas.
- **Boost = derivado, não armazenado.** O valor típico é a mediana ponderada pela duração dos intervalos nos últimos 60 dias; boost existe quando o valor atual atinge o limiar aprovado sobre esse típico. `value` e `value_partial` do Inter possuem bases independentes.
- **`raw_text` sempre preservado.** Quando o parser errar, você vê exatamente o que o site mostrava.
- **`last_seen_at` resolve o requisito F8 (lojas inativas)** — ver §5.
- **`pg_trgm`** dá busca tolerante a typos ("nkie" → Nike) de graça, sem Elasticsearch.
- **Deltas da Fase 3:** fontes privadas de logo por loja/plataforma, manifesto de aliases no Git,
  redirects de slugs absorvidos, views estreitas no schema `web_read`, roles separadas de leitura,
  ativação e logos. O desenho detalhado e os privilégios estão nas ADRs; não conceder acesso direto
  às tabelas operacionais para acomodar o frontend.

---

## 4. O scraper — onde o design importa

### Padrão adapter

Cada site é um módulo isolado que implementa um contrato único. Conserto de quebra = editar 1 arquivo.

```ts
// packages/shared/src/types.ts (fonte: docs/poc/src/shared.ts, validado nos 5 sites)
interface RawOffer {
  storeName: string;          // nome cru, como aparece no site
  rewardText: string;         // "7% Cashback", "R$ 15", "até 8%", "0.5% de volta" — cru
  previousRewardText?: string; // boost nativo: "era 2%" (méliuz/cuponomia; inter via campo da API)
  partialRewardText?: string; // tier inferior de acesso (inter: não-correntista → value_partial). Genérico: shared não conhece "correntista"
  url: string;
  logoUrl?: string;
}

// O adapter devolve um ScrapeResult, não RawOffer[] cru: além das ofertas, carrega
// os METADADOS DE COLETA que só ele observa (escopo, total declarado, itens recebidos,
// soft-blocks). Isso mantém a lei "adapter só extrai" — nenhum campo é interpretação de
// valor — e evita que o pipeline perca o número que o próprio site declara sobre si.
type RunScope =
  | { kind: 'full' }                          // inter, mycashback: varredura completa
  | { kind: 'partial'; slugs: Set<string> };  // coleta tiered (fase 2)

interface ScrapeResult {
  offers: RawOffer[];
  scope: RunScope;            // fase 1: { kind: 'full' }
  declaredTotal?: number;     // só onde há total de MÁQUINA autoritativo (inter, zoom)
  rawCount: number;           // itens recebidos com desfecho real, ANTES do filtro de inativas
  softBlocks: number;         // adapter conta; o pipeline aplica o limiar (config compartilhada)
}

interface PlatformAdapter {
  platformId: string;
  scrape(): Promise<ScrapeResult>;  // sem browser: fetch (HTML, API JSON ou flight RSC)
}
```

A regra de ouro: **adapters só extraem, nunca interpretam.** Todo parsing de valor, normalização de nome e decisão de ativo/inativo vive no pipeline compartilhado. Isso significa que a lógica difícil é escrita e testada uma vez só.

### Pipeline compartilhado

```
RawOffer[] ──▶ 1. validação zod (campos presentes? url válida?)
           ──▶ 2. parse do reward ("até 7,5%" → {percent, 7.5, upto:true})
           ──▶ 3. normalização de loja (alias → canônica; ver §5)
           ──▶ 4. sanity check do run (ver abaixo)
           ──▶ 5. upsert em transação + marcação de inativos
                  └─ valor mudou? → append em offer_history (delta-based)
```

### Sanity check: a defesa contra HTML que mudou

O modo mais perigoso de falha não é o crash — é o scraper que roda "com sucesso" e devolve dados errados. O `--live` de 09/07/2026 encontrou **três variantes reais** desse modo de falha: seletor devolvendo 20 de 212 *parecendo saudável* (zoom), shell vazio parseando 0 sem erro (inter), e soft-block transformando lojas ativas em inativas **sem mudar o total** (cuponomia). Defesa em quatro regras:

```
regra 1: offers_found < 60% da média dos últimos 5 runs ok  → 'suspicious', NÃO grava
regra 2: ACTIVE_OFFERS < 60% da média dos últimos 5 runs ok → 'suspicious', NÃO grava
         (pega o soft-block: o total de lojas fica idêntico, as ofertas somem;
          não se aplica ao scope tail, onde zero promoções é um resultado legítimo)
regra 3: parse_errors / offers_found > 10%                  → 'suspicious', NÃO grava
regra 4: declaredTotal ≠ rawCount                            → 'suspicious', NÃO grava
         (compara o total que o site DECLARA com os itens RECEBIDOS — não com offers.length,
          que já filtrou inativas: inter declara 374, recebe 374, mas só 363 são ofertas.
          Só onde há total de MÁQUINA autoritativo: inter pagination.total (+cross-check
          /v1/departments.numStores) · zoom "N lojas encontradas" vs sellers.length.
          Cuponomia/méliuz NÃO têm declaredTotal — diretório não-autoritativo, viajanet
          morta = 799≠798 permanente; nos runs active protege a regra 2, enquanto tail usa
          tamanho bruto + soft-block/backoff/circuit breaker. Foi a regra 4
          que desmascarou o parser DOM do zoom, 20 de 212.)
crash/timeout → 'failed'
em qualquer caso ≠ ok: dados do run anterior permanecem servindo o site
```

**Cold-start (o primeiro run não tem baseline).** As regras 1 e 2 são **relativas** — comparam com a média dos últimos runs `ok`. No primeiro run isso não existe; se dispararem sem histórico, nada é gravado e o baseline nunca nasce. Regra: **1 e 2 só engatam com ≥3 runs `ok`** de baseline (limiar em config compartilhada); abaixo disso é **cold-start** — o run é avaliado só pelas regras **absolutas** (3 e 4), e o `notes` registra "baseline frio". Assim o 1º run do inter grava se `pagination.total (374) == rawCount (374)` e parse_errors baixo, semeando o baseline.

**`scrape_runs.notes` é auto-diagnóstico** — JSON compacto serializado (parseável no dashboard, legível a olho):

```json
{ "verdict": "suspicious", "tripped": "rule4_declared_vs_raw",
  "baseline": { "n": 5, "avg_offers": 460, "avg_active": 458 },
  "actual": { "offers_found": 461, "active_offers": 205, "raw_count": 468,
              "declared_total": 374, "parse_errors": 2, "soft_blocks": 0 },
  "parse_error_samples": ["Cashback especial!", "R$ --"] }
```

O campo que mais importa no conserto é **`parse_error_samples`**: os 3–5 primeiros `rawText` que o `parseReward` recusou (truncados) — dizem o que o site mudou sem re-raspar.

**Orquestração e falha de fetch.** Cada plataforma roda isolada em try/catch e grava sua linha em `scrape_runs`; uma falhar não impede a outra. O runner sai com **exit code ≠ 0** se qualquer plataforma terminou `failed`/`suspicious` (sinal honesto local; e-mail do Actions na Fase 2). Todo fetch usa `AbortSignal.timeout()`; erro transitório (rede/5xx/timeout) → **2 retries com backoff** → depois `failed` (grava o erro em `notes`, zero escrita de oferta). O circuit-breaker de 12 soft-blocks é conceito de crawl (Fase 2), não exercitado na varredura completa da Fase 1 (`soft_blocks` = 0).

**`HTTP 200` ≠ "a página que pedi".** Todo parser de página de loja exige um **sinal de presença** (`.store_header` no cuponomia, `.hero-sec` no méliuz); ausência = **erro retentável com backoff**, nunca "loja sem cashback". Crawls gravam JSONL/`crawl_state` append-only e só marcam um slug como concluído com desfecho real — interromper e retomar não perde trabalho.

### Detecção e alerta

- Job do GitHub Actions **falha explicitamente** (exit 1) quando qualquer site termina `failed`/`suspicious` → e-mail automático do GitHub, de graça.
- Opcional (recomendado): notificação via **bot do Telegram** (grátis, 5 linhas de código) com resumo: `méliuz ✅ 1.204 | cuponomia ⚠️ 89 (suspicious) | ...`.
- Cada site roda **isolado por try/catch**: cuponomia quebrar não impede méliuz de atualizar.

### Testes de contrato com fixtures

Para cada site, salve 1–2 páginas HTML reais em `fixtures/`. Testes rodam o adapter contra o fixture e verificam a extração. Quando um site mudar: o teste com fixture antigo continua verde (regressão), o scrape real fica `suspicious` (detecção), você salva o HTML novo, ajusta seletores, atualiza o fixture. Ciclo de conserto: ~30 min.

### Anti-bloqueio: playbook (revisado após o soft-block real do cuponomia)

O único bloqueio observado em produção foi o **soft-block do cuponomia** (200 com a home, 17% do 1º crawl) — disparado por **taxa sustentada**, não por identidade do cliente. Por isso a resposta é reduzir pressão, não mascarar origem:

1. **Menos requests antes de mais truques.** Inter e zoom já caíram para 1 request. Cuponomia e méliuz usam **crawl tiered**: lojas com cashback conhecido 2×/dia; cauda sem cashback fatiada 1×/5 dias (`crawl_state.tier`). Corta ~65% da carga do cuponomia e evita a rajada de 2.355 do méliuz.
2. **Etiqueta**: ≥1,3–2s entre requests + jitter, ordem embaralhada, horários alternados (03h/15h UTC), User-Agent de browser real e constante.
3. **Backoff + circuit breaker** (já implementado no `cup-crawl`): soft-block → retry 8/16/24s; 12 soft-blocks consecutivos → **aborta a run inteira** (não grava lixo, dados anteriores continuam servindo). Sinal de presença por página (regra do sanity check).
4. **Sem proxies.** Proxy residencial pago fere o custo zero; proxy grátis é instável e um risco de segurança (o tráfego passa por terceiros desconhecidos). E é desproporcional: o soft-block cedeu a backoff leve na 2ª passada (4 retries em 138 slugs).
5. **Escada de fallback se o IP do GitHub Actions for bloqueado** (IPs de datacenter, mudam a cada run — ainda não testado): (a) aumentar delay/fatiar mais; (b) **self-hosted runner na sua máquina** — grátis, IP residencial, mesmo workflow; (c) Playwright para o site específico — os parsers rodam iguais sobre `page.content()`.
- Se um site ficar hostil demais, aceite degradar: atualiza menos ou sai do escopo. O sistema funciona com 4 de 5.
- ⚠️ Scraping pode violar ToS dos sites-alvo. Para uso pessoal, sem fins lucrativos e volume mínimo, o risco prático é baixo — mas é bom saber que existe.

---

## 5. Os dois problemas difíceis

### 5.1 Normalização de nomes de loja

Estratégia em camadas — automatize o fácil, revise o ambíguo:

```
nome cru ─▶ 1. chave L2 (minúsculas → sem acento → `+`→`plus`, `&`→`e` →
                tira domínio ".com.br" → tira pontuação → JUNTA os tokens sem espaço).
                ⚠️ NÃO remove palavras de ruído (loja/store/br/oficial) — isso é L3,
                REJEITADO no POC: quebra Fast Shop×Fastshop e funde Disney+ com Disney Store.
         ─▶ 2. match exato em store_aliases?          → usa (fim)
         ─▶ 3. slug (== chave L2) == slug de loja canônica? → cria alias 'auto'
         ─▶ 4. similaridade trigram?                  → gera candidato para revisão (FASE 3)
         ─▶ 5. sem match                              → cria loja nova + alias 'auto'
```

**Escopo Fase 1:** só as camadas **1, 2, 3, 5** — find-or-create por chave L2 exata.
A chave L2 **é** o `stores.slug` (único); `store_aliases.raw_name` guarda o nome cru por site.
Nome canônico = **first-writer-wins** (não sobrescreve; prioridade de fonte é da Fase 3).
A camada **4 é Fase 3**: trigram, evidências determinísticas e IA podem propor candidatos, mas nunca
fazem merge. Os 45 candidatos conhecidos e os novos entram num manifesto versionado no Git. Revisão
humana aprova `merge` ou `reject` em PR; somente o merge do PR materializa a decisão no Supabase.
`/admin/aliases` não faz parte desta fase.
Fase 1 prefere **sub-mesclar** (Nike × Nike Store separados até a curadoria) a mesclar errado.

- A tabela `store_aliases` é a projeção operacional; o manifesto no Git é o histórico auditável das decisões humanas.
- Candidatos pendentes aparecem em PR e summary da Action. IA é best-effort e apenas ordena/explica; confiança do modelo nunca autoriza merge.
- Domínio da loja (quando a plataforma expõe) é o desempate mais confiável: `nike.com.br` bate com `nike.com.br` independente do nome exibido.
- **POC feito** (`docs/poc/src/normalize.ts`): chave canônica L2 (0 colisões em 1.853 nomes), fuzzy só como gerador de candidatos p/ revisão (45 pares em `alias-candidates.json`), `store_aliases` com union-find p/ clusters transitivos. **Só 42% das lojas existem em ≥2 plataformas** — a UI trata "uma plataforma só" como caso normal, não como erro.
- Nome/logo do méliuz saem do `ld+json @type:Store` da página da loja (derivar nome de slug erra ~10%). Logos: auto-hospedar (~4,4 MB total) e processar em Action separada, disparada automaticamente após o scrape — detalhes no `CLAUDE.md` §Logos.

### 5.2 Comparação % vs R$ fixo (e "até X%")

Não são comparáveis sem o valor da compra — não finja que são:

- **Ofertas dentro da loja:** `%` vem **sempre antes** de qualquer valor fixo (`R$`, `$` ou outra moeda). Dentro de cada grupo, valor decrescente. Não existe calculadora nem conversão entre grupos nesta entrega.
- **Ordenação de lojas por “Maior cashback”:** lojas com alguma oferta percentual vêm antes das exclusivamente fixas; cada grupo usa seu maior valor. A taxa Inter de referência é sempre a de correntista para que o toggle não mova lojas.
- **"até 8%"**: armazena `value=8, is_upto=true`, exibe "até 8%" com estilo próprio. Trata como teto, não como promessa — na ordenação vale 8, mas o badge avisa.
- **R$ fixo é real e não é raro**: 15 lojas no cuponomia + 42 no méliuz (apostas/educação/antivírus). O `parseReward` cobre desde o v1.
- 🐛 **Armadilha de JS no `parseReward`**: `\b` não funciona após letra acentuada (`/\bat[ée]\b/` falha em `"Ativar até 10%"`). Remover acentos **antes** de aplicar limites de palavra.

### F8 — lojas com cashback inativo

Duas camadas:

1. **No adapter:** cada site marca visualmente lojas sem cashback ativo de um jeito ("indisponível", sem valor, CSS diferente) — o adapter simplesmente não emite `RawOffer` para elas (se não tem `rewardText` parseável, não é oferta).
2. **No pipeline:** após um run `ok` de um site, toda oferta daquele site com `last_seen_at` < início do run vira `active=false`. Sumiu do site = desativada automaticamente. Nada de deleção — se voltar, reativa.

---

## 6. Frontend (Next.js / Vercel)

| Rota | Conteúdo | Renderização |
|------|----------|--------------|
| `/` | Catálogo completo, busca, ordenação e paginação de 24 lojas | Server Components + cache `catalog` |
| `/loja/[slug]` | Ranking completo, histórico real de 60 dias e ativação | Server Components + cache `catalog` |
| `/plataformas` | Contagem, média percentual e pico das cinco plataformas | Server Components + cache `catalog` |
| `/como-funciona` | Conteúdo editorial versionado no Git | estática |
| `/faq` | Conteúdo editorial versionado no Git | estática |
| `/go/[storeSlug]/[platformId]` | Revalidação server-side e redirect temporário | dinâmica, sem cache |

- A home lista todas as lojas elegíveis. A ordem padrão é cobertura de plataformas; “Maior
  cashback” e “A–Z” são alternativas. Busca, página e ordem vivem na URL. Busca prioriza relevância
  e não usa `/api/search`.
- Card recebe todas as ofertas e mostra até três; `+N` abre o detalhe. Uma plataforma só é caso
  normal.
- O toggle Inter começa ligado, persiste em `localStorage` e aparece na home e no detalhe. Reordena
  ofertas dentro da loja, não lojas no catálogo.
- O histórico é step chart com âncora anterior à janela e lacunas em desativação. Sem mudança real,
  mostra “Histórico sendo construído”. Percentual e fixo não compartilham escala.
- O CTA recebe apenas a rota `/go`; `offers.url` fica server-only até a validação do clique. Oferta
  encerrada produz 410; falha temporária, 503; nunca há redirect para URL antiga.
- Dados de catálogo usam tag ampla `catalog`, TTL de ~1 h e expiração imediata por `POST` autenticado
  com HMAC depois de scrape aceito, curadoria ou troca de logo final.
- Next.js conecta ao Postgres pelo Supavisor com a role `farejo_web`, somente leitura das views
  `web_read`. Não existe cliente Supabase no navegador, credencial `NEXT_PUBLIC_` nem `service_role`
  na Vercel.
- Visual desktop segue `design_handoff_farejo/` em 1440 px. Larguras menores mantêm reflow funcional
  e acessível; o handoff mobile de alta fidelidade é posterior.

### 6.1 Logos e ícones (POC em `docs/poc/src/assets.ts`, 09/07/2026)

- **Auto-hospedar os logos no Supabase Storage, não hotlinkar das plataformas.** Nenhuma das 5 bloqueia hotlink *hoje*, mas a POC mediu por que não confiar nisso: uma regra de `Referer` futura quebraria todas as imagens de uma vez (e em silêncio); inter/zoom servem `Content-Type: octet-stream` (o `next/image` recusa); inter não manda `cache-control` e méliuz manda `private` (cada pageview re-baixa). Além de técnico, é etiqueta: não puxar banda de quem estamos comparando.
- **Custo medido: irrelevante.** ~4,2 KB/logo × ~1.063 lojas canônicas ≈ **4,4 MB** no Storage (free tier: 1 GB).
- **1 logo por loja canônica**, não por oferta. Normalizar para **webp quadrado ~128px**. Prioridade de fonte quando a loja existe em várias plataformas: **zoom (200×200) > méliuz > cuponomia**; mycashback é banner 250×80 — só fallback. Sem logo → avatar com a inicial (como o zoom faz).
- **Action separada, automática após o scrape**: processa somente fontes novas, alteradas ou sem
  resultado; guarda `logo_hash`, publica antes de trocar o ponteiro e não bloqueia a coleta.
- **Ícones das 5 plataformas ≠ logos de loja**: são 5 assets fixos versionados no repo (`apps/web/public/portals/*.svg`). Não raspar. Uso nominativo para comparação, marcas inalteradas.
- 🐛 Bug encontrado e corrigido: no mycashback, `img.product-logo[src]` é sempre `/img/noimage.jpg` (placeholder do lazysizes) — o logo real está em `data-src`.

## 7. Custo — confirmando o R$ 0

| Recurso | Free tier | Uso estimado | Folga |
|---------|-----------|--------------|-------|
| GitHub Actions | Ilimitado em repo público (2.000 min/mês privado) | ~40 min/run (cuponomia ~21 min + méliuz tiered ~17 min + 3 sites ~1 min) × 60 runs ≈ 2.400 min/mês | ✅ público (privado estouraria — mais um motivo p/ repo público) |
| Supabase | 500 MB, pausa após 7 dias sem uso | < 50 MB (histórico delta-based: ~poucos MB/ano) | ✅ (o scrape 2×/dia mantém ativo) |
| Vercel hobby | 100 GB bandwidth | uso pessoal | ✅ |
| Telegram bot | grátis | alertas | ✅ |

Único cuidado: repo privado com scrapes lentos pode raspar o teto de 2.000 min. Mitigação: repo público (não há segredo no código; credenciais ficam em GitHub Secrets) ou otimizar adapters para endpoints JSON.

## 8. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Site muda HTML | Alta (é quando, não se) | Dados desatualizados de 1 plataforma | Adapters isolados + sanity check + fixtures + alerta → conserto de ~30 min |
| Anti-bot bloqueia | **Confirmado no cuponomia** (soft-block por taxa; cedeu a backoff) | Ofertas viram "inativas" silenciosamente | Playbook §4: tiered + backoff + circuit breaker + sanity de ofertas ativas; escada fetch → self-hosted runner → Playwright. Sem proxies |
| API interna muda (inter/zoom) | Média | Perde 1 plataforma até ajustar | Mesmo tratamento de HTML: fixture do JSON, teste de contrato, cross-check com total declarado |
| Normalização errada | Média | Loja duplicada ou cashback de lojas diferentes mesclado | Chave L2 conservadora + candidatos no Git + revisão humana; fuzzy/IA nunca fazem auto-merge |
| Credencial web exposta | Baixa | Leitura ou escrita indevida no banco | Postgres server-only, role `farejo_web`, views `web_read`, sem Data API no browser e sem `service_role` na Vercel |
| Cache antigo após scrape | Média | Cashback incorreto permanece visível | Invalidação HMAC por tag após escrita aceita + TTL de segurança |
| Free tier muda | Baixa | Migração | Tudo é Postgres + Node padrão; portável para Neon/Railway/Fly em horas |
| GitHub Actions cron atrasa | Certa (atrasos de minutos~horas em horário de pico) | Irrelevante | 12h de frequência tolera qualquer atraso |

## 9. Roadmap sugerido

1. **Fase 0 — concluída:** POCs e validação `--live` das cinco plataformas.
2. **Fase 1 — concluída:** monorepo, schema base, pipeline, sanity, Inter e MyCashback.
3. **Fase 2 — concluída:** demais adapters, crawl tiered, CI e GitHub Action de scraping validada
   contra o Supabase hospedado.
4. **Fase 3 — planejada:** curadoria de aliases no Git, fontes/ingestão automática de logos, read
   model seguro, cache/invalidação, frontend público completo e publicação coordenada.
5. **Posterior:** handoff mobile de alta fidelidade, popularidade pública, outras lojas relacionadas,
   Termos/Privacidade e novas plataformas.

## 10. O que revisitar se crescer

- **Alertas de cashback** ("me avise quando Nike passar de 8%") → precisa de e-mail/push; Resend free tier.
- **Categorias de loja** e páginas por categoria.
- **Mais plataformas** (Banco PAN, PicPay, Ame...) — o custo marginal de um adapter é pequeno depois que o pipeline existe.
- Se o público crescer de verdade: mover scraper para fila (SQS + workers — aí suas skills de Spring/SQS entram em jogo 🙂), cache CDN, e revisitar a questão de ToS/afiliação.
