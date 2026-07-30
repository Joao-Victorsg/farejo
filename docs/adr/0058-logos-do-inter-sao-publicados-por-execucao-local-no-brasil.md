# Logos do Inter são publicados por execução local a partir do Brasil

## Contexto

Com os downloads destravados pela ADR-0057, a cobertura de logos parou em **93,8%** (974/1038),
abaixo da meta de 95% da ADR-0043. As 64 fontes restantes falhavam todas com HTTP 403: 48 do Inter
e 16 do Méliuz.

As 16 do Méliuz são reais: a página pública da loja no site deles declara hoje exatamente a URL
que responde 403 — o logo está quebrado na origem. O fallback visual da ADR-0038 é a resposta
correta e não há o que corrigir do nosso lado.

As 48 do Inter eram outra coisa. As mesmas URLs, com o mesmo User-Agent e a mesma forma de
requisição (`Agent` com `lookup` fixado), devolvem **200 a partir do Brasil** — verificado 12/12
localmente, e 47 de 47 sobre a lista exata das lojas presas em fallback, cruzada com o feed vigente
da API do Inter. Uma sonda rodada de dentro do runner do GitHub testou seis variações de cabeçalho
(User-Agent de browser, `Referer`, `Origin`, `Accept`, `Accept-Language`, todas combinadas):
**403 nas seis**. A resposta explicou por quê:

```
x-amz-cf-pop: SFO53-P8
x-cache: Error from cloudfront
server: AmazonS3
```

É geo-restrição de CloudFront. Do Brasil o PoP atendente é GRU e responde 200; do runner o PoP é
San Francisco e responde 403. Não é bloqueio ao runner em geral: no mesmo run, a API de lojas do
Inter respondeu 200 e o CDN da Cuponomia também. Cabeçalho nenhum resolve — a decisão do CDN é pela
origem da conexão.

Fechar isso exige egress no Brasil. A alternativa considerada era uma rota interna no app da Vercel,
que já roda em `gru1`, autenticada por HMAC e com allowlist de um único host. Foi descartada: põe
uma requisição para fora dentro do app público — o componente de maior exposição do sistema — para
resolver um problema estético de 4,5% do catálogo. A troca não compensa.

## Decisão

Os logos bloqueados por geo-restrição são publicados executando o **mesmo `logos:ingest`**
localmente, a partir do Brasil, com as credenciais do Environment `logos`. Não existe script
separado, nem caminho de código alternativo: é o entrypoint de produção, com a mesma validação de
SSRF, normalização, dedup por conteúdo, troca de ponteiro e gravação de verificação. A única coisa
que muda é o IP de saída, que é exatamente a variável que o CloudFront julga.

A Action hospedada permanece inalterada e continua sendo o caminho normal. Ela seguirá falhando nas
fontes do Inter que ainda não foram publicadas, e isso é esperado, não regressão.

Nada disso alarga a fronteira da ADR-0042: a role `farejo_logo_writer` continua sem enxergar
ofertas, aliases ou histórico, e só atualiza `stores.logo_url`/`logo_hash`. É justamente por a
fronteira ser estreita que rodá-la de uma máquina pessoal é aceitável.

## Consequências

- **95% passa a ser um número mantido à mão.** O pipeline hospedado sozinho entrega ~93,8%. Quem
  ler `logo_coverage >= 95%` no log da Action precisa saber que o excedente veio de execução
  manual, ou vai concluir que a automação garante algo que ela não garante. O critério de
  lançamento continua válido; o que muda é quem o sustenta.
- **A cobertura decai sozinha.** Loja nova só-Inter, ou loja cuja `imageUrl` mudou, volta a ficar
  sem logo até alguém rodar de novo. O sinal para isso é `inter/http_403` no diagnóstico por
  plataforma (ADR-0057) — sem precisar abrir o banco.
- **O que foi publicado é estável.** Depois do run local a loja tem `logo_hash` e a fonte fica com
  `verified_url = url`, então ela sai do conjunto de `selectCandidateStores`. O run hospedado não
  tenta de novo, não reverte o ponteiro e não gasta um 403 à toa.
- Credencial de escrita de produção passa a existir em disco, num `.env` local. Coberto pelo
  `.gitignore` (`.env*`, exceto `.env.example`), o que importa num repo público.
- Se um dia houver egress brasileiro barato e sem superfície nova (runner self-hosted, por
  exemplo), esta decisão deve ser revisitada: ela troca automação por trabalho manual recorrente, e
  só se sustenta enquanto o volume for este.

## Procedimento

`apps/scraper/.env` com os secrets do Environment `logos` (`ingest.ts` já carrega `dotenv/config`),
e `pnpm --filter @farejo/scraper logos:ingest`. Três armadilhas custaram tempo na primeira execução
e não são óbvias em nenhuma mensagem de erro:

- **O PEM não pode ser indentado.** Colado alinhado sob a chave, o dotenv preserva os espaços e o
  OpenSSL recusa com `PEM routines::bad end line`, que não menciona indentação. Vale entre aspas
  duplas, em várias linhas ou em uma só com `\n` escapado — sem aspas, o valor é cortado na
  primeira quebra.
- **A connection string não pode conter `sslmode`** (ADR-0055). O `postgresPool.ts` falha
  explícito; sem essa guarda o CA seria descartado em silêncio.
- **O host do pooler é `aws-1-sa-east-1.pooler.supabase.com`.** O `aws-0` resolve em DNS e responde
  `tenant/user not found`, o que parece erro de credencial e não de host.

Rodar da árvore de trabalho certa também importa: uma primeira tentativa saiu de um worktree
anterior ao merge da ADR-0057 e reproduziu o `0 atualizadas` do bug já corrigido.

Resultado da primeira execução: 69 candidatas, **48 atualizadas**, 21 seguindo no fallback (16 do
Méliuz quebradas na origem, 5 sem nenhuma fonte). Catálogo público em **98,4%**.
