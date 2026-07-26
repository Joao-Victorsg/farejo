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

**O smoke pós-deploy afirma a camada externa.** A regra de WAF é um controle crítico configurado no
dashboard, invisível no código e silenciosamente ausente se alguém a apagar. O runner do GitHub
Actions **não** está nas faixas do Telegram, então uma requisição dele para o webhook **tem que ser
negada na borda**, sem chegar à aplicação; e uma requisição com header errado tem que responder 401.
É a mesma filosofia da ADR-0062 (provar o negativo) e da ADR-0059 (afirmar conteúdo, não só status).

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
  BotFather, criar o projeto `apps/bot` na Vercel, criar a regra de WAF e rodar o `setWebhook`. Sem
  elas o workflow falha cedo, num passo de guarda.
- O Hobby da Vercel permite **3 regras** de WAF — orçamento fixo compartilhado com qualquer regra
  futura do site.
