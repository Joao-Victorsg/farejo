# A escrita do bot vive num deployable próprio, com role separada da leitura de histórico

## Contexto

Os **Avisos** exigem duas capacidades que o farejô nunca teve: receber mensagem de fora (criar e
alterar **Inscrições**) e enviar mensagem por iniciativa própria. O envio já existe
(`sendTelegramMessage`, `apps/scraper/src/summary.ts`); a entrada é capacidade nova, e ela precisa
de um endpoint HTTP público — o que colide com a postura do projeto: `apps/web` é leitura pura,
`farejo_web` só tem `SELECT` em `web_read`, e não há Data API exposta.

## Decisão

**Um deployable novo: `apps/bot`, projeto próprio na Vercel.** Não é rota de `apps/web`, que
continua sem endpoint de escrita e sem segredo de escrita.

**Duas roles de login, não uma.**

| | `farejo_bot` (entrada) | `farejo_notifier` (saída) |
|---|---|---|
| inscrições | insert/update/delete | select + update do cursor |
| `stores` | select | select (nomear a loja no Aviso) |
| redirects de slug | select, **via `web_read`** | **nunca** — não resolve slug |
| ofertas correntes | select **via `web_read`** | select |
| `offer_history` | **nunca** | select |
| exposição | pública na internet | dentro do Actions |

Uma role só daria à superfície **pública** leitura do histórico inteiro de ofertas, que ela nunca
usa. O projeto já separa por muito menos: a ADR-0054 criou `farejo_logo_coverage` em vez de alargar
`farejo_logo_writer`. Com duas roles, "a superfície pública não lê o histórico" deixa de ser texto e
vira asserção do gate de publicação (ADR-0062).

**O bot lê pelas views de `web_read`, não por `public.offers`.** A validação de piso contra as
ofertas correntes precisa da mesma definição de oferta pública elegível que o site usa — frescor de
48 h incluído. Lendo a tabela crua, o bot confirmaria um piso contra oferta que o site já considera
expirada: duas definições de "oferta válida" no mesmo produto.

**A allowlist da ADR-0062 e o contrato da ADR-0061 são trabalho obrigatório do ticket.** Toda role,
tabela e grant novo entra em `verify-privileges.ts` e `verify-schema.ts`, ou o `deploy.yml` reprova —
de propósito.

## Considered Options

**Rota no Next (`apps/web`)** — rejeitada: daria ao app público um endpoint e um segredo de escrita,
contra a postura de leitura pura.

**Polling do Actions (`getUpdates`)** — rejeitada: é o único desenho **sem** endpoint público, mas o
ack ficaria em 5–15 min. Um bot que demora minutos para responder ao `/start` é lido como quebrado.

**Canal do Telegram em vez de inscrição** — considerada e adiada, não descartada por ser ruim: elimina
o endpoint público, a tabela, as roles e **toda** a PII, e o envio já funcionaria sem código novo.
Perde a personalização inteira (sem escolha de loja, sem piso), e um canal com ~1000 lojas melhorando
2×/dia é um firehose. Fica como alternativa viva caso a inscrição se mostre cara demais.

**Supabase Edge Function (Deno)** — era a escolha inicial, revertida por evidência. Três problemas,
sendo o primeiro decisivo:

1. **Sem rate limit de plataforma, e requisição bloqueada conta na cota assim mesmo** — a invocação
   é contabilizada antes do código rodar, então "responder 401 barato" não protege o recurso que
   está em risco (500 mil invocações/mês). Na Vercel, `deny`/`rate-limit` de regra de WAF **não são
   cobrados**, então o tráfego hostil é descartado antes de custar (ADR-0065).
2. **Deno num monorepo pnpm/vitest**: acoplaria parte do domínio a um runtime fora da suíte de
   testes do projeto.
3. **Quarta cópia do helper da ADR-0055** — e a pior delas: em Deno não dá nem para copiar (outro
   driver, outro runtime, zero reuso).

## Consequências

- `apps/web` fica **inalterado** por esta feature no que diz respeito a dados: o deep-link é
  `slug` + usuário do bot, nenhum campo novo atravessa `web_read`, a ADR-0028 fica intacta e o link
  estático não participa da tag `catalog`.
- O domínio do bot fica em TypeScript, sob vitest, com acesso a `@farejo/shared` — mesma toolchain do
  resto do monorepo.
- O pool com verificação de certificado (ADR-0055) já é um pacote do workspace desde a #112
  (`@farejo/postgres`), então `apps/bot` nasce importando em vez de virar uma quarta cópia.
- Sequência de publicação passa a ser: migrations (tabela + as duas roles) → `verify:schema` +
  `verify:privileges` → deploy do `apps/bot` → smoke do bot → `setWebhook` (manual, único, refeito só
  se a URL mudar).
- Environments separados, no padrão do `logos`: `bot` (token do produto + `FAREJO_BOT_DATABASE_URL`) e
  `avisos` (token do produto + `FAREJO_NOTIFIER_DATABASE_URL`). Nenhum deles reaproveita os secrets do
  scrape.
- A feature **não depende do site para funcionar**: quem chega em `t.me/<bot>` e manda `/start amazon`
  fica inscrito sem o site participar. O CTA em `/loja/[slug]` é caminho de descoberta, e está
  bloqueado por gate próprio — o handoff precisa conter o elemento, na posição exata, antes de
  qualquer implementação na web (ADR-0043, `CLAUDE.md`). Se o handoff nunca ganhar o elemento,
  perde-se a descoberta, não o produto.
