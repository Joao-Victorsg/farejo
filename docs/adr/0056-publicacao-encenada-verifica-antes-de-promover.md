# Publicação encenada: o smoke verifica o artefato novo antes de promovê-lo

## Contexto

A ADR-0041 desenhou a publicação como deploy → smoke → rollback em caso de falha. Em 21/07/2026,
a primeira sequência real de publicações expôs dois defeitos que só aparecem quando algo falha.

O smoke mirava `FAREJO_SITE_URL` — o domínio de produção — e não o deployment que o próprio
workflow acabara de criar. Isso é correto apenas enquanto o deploy move o domínio de imediato. Um
`vercel rollback` fixa a produção num deployment anterior, e a Vercel deixa de mover o domínio para
os deployments seguintes até o pin ser desfeito. A partir daí o smoke passa a medir o artefato
antigo: aprova ou reprova algo que não é o que foi publicado. Como a reprovação dispara outro
rollback, o workflow entra num ciclo do qual não sai sozinho — toda publicação seguinte falha pelo
mesmo motivo, e o operador vê "deploy falhou" sem que exista defeito no artefato novo.

O segundo defeito é do próprio rollback: o plano gratuito da Vercel permite voltar apenas ao
deployment imediatamente anterior. A segunda tentativa devolve HTTP 402, então o passo de
recuperação falha justamente quando é mais necessário.

Havia ainda uma janela conceitual no desenho original: entre o deploy e o resultado do smoke, o
público já estava recebendo um artefato ainda não verificado.

## Decisão

A publicação passa a ser encenada. `vercel deploy --prebuilt --prod --skip-domain` cria o
deployment de produção **sem** mover o domínio; o smoke roda contra a URL desse deployment
(`steps.deploy.outputs.url`), nunca contra o domínio; e só depois de ele passar
`vercel promote` torna o artefato público.

O público nunca vê um artefato não verificado, e não existe mais nada a reverter: falha em qualquer
passo deixa a produção intacta no deployment anterior. O passo de rollback é removido — com ele, a
dependência de um recurso que o plano gratuito recusa.

URLs de deployment ficam atrás da Deployment Protection da Vercel (só o domínio de produção é
público), então o smoke envia `x-vercel-protection-bypass` com
`VERCEL_AUTOMATION_BYPASS_SECRET`. Acompanha `x-vercel-set-bypass-cookie: false`, para o bypass
valer por requisição e não deixar sessão autenticada para trás. O segredo é opcional no script: sem
ele o smoke continua servindo para apontar direto a um domínio público.

`FAREJO_SITE_URL` deixa de ser secret exigido pelo workflow. O domínio público continua existindo,
mas quem o lê é a app em runtime, pela env var da Vercel — nenhum passo do workflow o consome, e
exigi-lo no guard bloquearia a publicação por uma dependência inexistente.

## Consequências

- O smoke sempre mede exatamente o artefato que acabou de ser construído, independentemente de qual
  deployment o domínio esteja servindo.
- Uma publicação reprovada não deixa rastro em produção e não exige nenhuma ação de recuperação.
- O ciclo em que um pin de produção condenava todas as publicações seguintes deixa de ser possível.
- `VERCEL_AUTOMATION_BYPASS_SECRET` passa a ser secret obrigatório do Environment `production`,
  exigido explicitamente pelo guard.
- Um deployment reprovado permanece `Ready` e acessível pela URL protegida, útil para depuração.
- Desativar a Deployment Protection no projeto tornaria o bypass desnecessário, mas exporia todos
  os deployments; a decisão é manter a proteção e conviver com o segredo.
