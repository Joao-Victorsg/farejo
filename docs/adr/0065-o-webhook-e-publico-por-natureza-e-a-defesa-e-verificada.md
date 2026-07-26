# O webhook é público por natureza, então a defesa é em camadas e verificada no deploy

## Contexto

O webhook do bot é o **primeiro endpoint público de escrita** do projeto. Três fatos delimitam o que
é possível:

1. **O Telegram só oferece um mecanismo de autenticação: um bearer estático.** `setWebhook` aceita
   `secret_token` ("*A secret token to be sent in a header `X-Telegram-Bot-Api-Secret-Token` in every
   webhook request*"). Os outros parâmetros parecem resolver e não resolvem: `certificate` é o
   **nosso** certificado para o Telegram nos validar (autenticação de servidor, não de cliente), e
   `ip_address` é o IP **do nosso servidor**, usado no lugar do DNS. Não há HMAC sobre o corpo — ao
   contrário do precedente interno do projeto (`api/internal/catalog-invalidation`) — e não há mTLS.
2. **O host do Supabase já é público.** `apps/scraper/src/logos/storage.ts` monta `stores.logo_url`
   como `${FAREJO_LOGO_PUBLIC_BASE_URL}/${key}`, e essas URLs de Storage carregam o `project-ref` no
   HTML de todo card de loja. Qualquer endpoint hospedado ali é endereçável a partir do site.
3. **O Telegram publica de onde ele fala**: `149.154.160.0/20` e `91.108.4.0/22`.

Como o protocolo não oferece mais nada, **toda proteção adicional tem que vir da hospedagem** — e
foi isso que decidiu a escolha de plataforma na ADR-0064.

## Decisão

**Defesa em duas camadas, com papéis distintos.**

1. **Externa — regra de WAF na Vercel** permitindo apenas as duas faixas do Telegram no caminho do
   webhook. Reduz exposição: o tráfego hostil é descartado na borda e **não é cobrado** (nem request
   nem banda), então não consome cota.
2. **Interna — `secret_token` no header.** As faixas de IP não autenticam ninguém; a autenticação
   real continua sendo o segredo. Header inválido responde **401 sem corpo**, sem revelar se um chat
   ou uma loja existe.

**O smoke afirma a camada externa — mas só depois da promoção (#120, corrigido testando ao vivo).**
A regra de WAF é um controle crítico configurado no dashboard, invisível no código e
silenciosamente ausente se alguém a apagar. A tentativa original era testar isso ANTES de promover,
contra a URL staged (`--skip-domain`) que o resto do smoke já usa — mas regras de WAF customizadas
da Vercel **não se aplicam a deployments staged**, só ao domínio de produção promovido. Confirmado
ao vivo: a mesma requisição sem nenhum header, contra o domínio real, recebe `403 Forbidden` com o
header `X-Vercel-Mitigated: deny` (a regra do usuário funcionando); contra a URL staged recebe
`401` da **Deployment Protection** — um subsistema totalmente diferente, que nem chega a avaliar a
regra de WAF. Testar a rede pré-promoção faria essa checagem falhar SEMPRE, mesmo com a regra
perfeitamente configurada, travando "Promote to production" para sempre.

A verificação se divide nos dois lados da promoção, seguindo uma assimetria: código muda a cada
deploy e precisa de gate bloqueante; a regra de WAF é configuração de conta da Vercel, muda raramente
(só edição manual no dashboard) e não precisa ser re-verificada como gate a cada deploy do mesmo
jeito.

- **Pré-promoção (bloqueante)**: só prova que o CÓDIGO implantado está saudável — bypass de
  Deployment Protection + `secret_token` errado de propósito → `401` da própria aplicação. O runner
  do GitHub Actions **não** está nas faixas do Telegram, mas essa checagem não prova nada sobre a
  rede; é a mesma filosofia da ADR-0062 (provar o negativo) e da ADR-0059 (afirmar conteúdo, não só
  status), aplicada à camada que dá pra afirmar nesse ponto.
- **Pós-promoção (não-bloqueante)**: só aqui, contra o domínio real, é possível provar as duas
  metades da promessa juntas — requisição sem nenhum bypass → `403` (Deny); com o bypass de uma
  **segunda regra na Vercel, de Bypass**, prioridade maior que a de deny, casando um header próprio
  deste projeto (`x-farejo-bot-smoke-bypass`, valor de `FAREJO_BOT_WAF_BYPASS_SECRET`, que tráfego
  real do Telegram nunca carrega) + `secret_token` errado → `401` da aplicação. `continue-on-error`
  de propósito: a publicação já aconteceu (o plano Hobby da Vercel recusa `vercel rollback` depois
  do primeiro uso, mesmo motivo que já descartou esse padrão no `deploy.yml` do site), e uma regra
  mal configurada se conserta no dashboard, não revertendo o deploy.

`x-vercel-protection-bypass` (usado pelo smoke do site para passar pela Deployment Protection) não
substitui a regra de Bypass acima nem vice-versa: a documentação da Vercel descreve Deployment
Protection e regra de WAF como camadas distintas, sem garantir que o bypass de uma alcance a outra —
os dois bypasses continuam sendo coisas diferentes, para propósitos diferentes.

**Redução de superfície:**

- **`allowed_updates = ["message", "my_chat_member"]`** — o Telegram nem entrega `edited_message`,
  `callback_query`, `inline_query`, `channel_post` e o resto. Menos superfície e menos invocação.
- **Caminho do webhook não-adivinhável** (um segmento aleatório, não `/telegram-webhook`). A URL vira
  um segundo segredo, rotacionável com um `setWebhook`.
- **Teto de 10 inscrições por chat.** Sem teto, uma conta assina o catálogo inteiro e vira
  amplificador (linhas no banco + mensagem gigante todo run).
- **Nunca ecoar entrada do usuário.** `sendTelegramMessage` já envia `{chat_id, text}` sem
  `parse_mode`, então não há HTML/Markdown para injetar — propriedade a **preservar** explicitamente.
- **Comandos sem máquina de estado conversacional**: `/piso <slug> <valor>` em vez de diálogo em
  etapas. Toda escrita responde com o estado resultante ("Amazon: agora com piso de 10%"), nunca só
  "ok".

**Dois bots, dois tokens.** O bot operacional de hoje (resumo de run, ADR de Fase 2) fica privado e
**sem webhook**; o bot de produto tem token próprio. O token do bot de produto é o segredo mais
perigoso do projeto — quem o tiver consegue mandar mensagem para **todos os assinantes** se passando
pelo farejô —, então ele não convive no mesmo Environment que o `service_role` do scrape.

## Consequências

- **A allowlist de IP não cobre abuso *através* do Telegram.** Mensagens hostis enviadas ao bot
  chegam pelas faixas permitidas, por dentro da regra. E rate limit por IP é inútil aqui: todo o
  tráfego legítimo vem dos mesmos IPs, então limitar por IP estrangula o bot em vez do abusador. A
  única chave útil contra esse vetor é o `chat_id`, e essa defesa já custou uma invocação quando
  roda. O teto de 10 inscrições limita o dano persistente; o transitório é aceito.
- **As faixas do Telegram podem mudar** (a própria documentação avisa). O sintoma é o bot emudecer
  sem erro visível, e a recuperação é atualizar a regra. É risco assumido em troca de a cota estar
  protegida no dia a dia.
- **Risco residual declarado:** quem descobrir a URL e o segredo consegue escrever inscrições; quem
  descobrir só a URL consegue, no máximo, gerar 401s dentro do orçamento da WAF. Em nenhum dos casos
  o site é afetado — `apps/web` lê Postgres direto via Supavisor e não passa por este deployable. A
  feature falha sozinha.
- **Pendências operacionais**, no mesmo padrão do Environment `logos`: criar o bot de produto no
  BotFather, criar o projeto `apps/bot` na Vercel, criar a regra de WAF (deny fora das faixas do
  Telegram) e a regra de Bypass (`x-farejo-bot-smoke-bypass`, prioridade maior, #120), rodar o
  `setWebhook`, e configurar o Environment `bot` com `VERCEL_TOKEN`/`VERCEL_ORG_ID`/
  `VERCEL_PROJECT_ID`/`FAREJO_BOT_WEBHOOK_PATH`/`VERCEL_AUTOMATION_BYPASS_SECRET` (este último já
  alimentava o smoke pré-promoção desde o #120, sem mudança) e mais dois novos —
  `FAREJO_BOT_WAF_BYPASS_SECRET`/`FAREJO_BOT_PRODUCTION_URL` — que só alimentam o passo
  não-bloqueante "Confirm WAF on production domain", pós-promoção. `FAREJO_BOT_PRODUCTION_URL` tem
  nome deliberadamente diferente de `FAREJO_BOT_SITE_URL` (a variável interna do smoke pré-promoção,
  que aponta pra URL efêmera do deployment staged, nunca pro domínio fixo) — mesmo nome pros dois
  confundiria quem lesse o workflow. **Diferente do padrão de "falha cedo, num passo de guarda"**
  usado em `deploy.yml`/`avisos.yml`: `deploy-bot.yml` (#120) dispara em todo "Deploy production"
  bem-sucedido — ou seja, em todo merge para `master` —, então a ausência do Environment vira só um
  aviso e o job de publicação do bot é pulado, verde, em vez de um red X permanente até a
  configuração existir. Ao criar o projeto na Vercel, `FAREJO_BOT_DATABASE_URL`/
  `FAREJO_BOT_WEBHOOK_SECRET`/`FAREJO_SITE_URL` (variáveis de runtime, lidas pelo próprio bot) têm
  que ser escopadas só para Production — mesmo alerta já registrado para `apps/web` (ADR-0037):
  nenhuma delas pode chegar a Preview.
- O Hobby da Vercel permite **3 regras** de WAF — orçamento fixo compartilhado com qualquer regra
  futura do site.
