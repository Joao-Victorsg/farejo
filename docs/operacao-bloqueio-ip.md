# Bloqueio persistente de IP

Este runbook trata bloqueio persistente de um portal pelo IP do GitHub Actions. A
escalada é deliberadamente manual: o scraper já reduz a velocidade entre runs por
meio do `throttle_multiplier`; não há troca automática de infraestrutura nem
Playwright nesta fase.

## Sinal para agir

Investigue quando a mesma plataforma tiver **três runs consecutivos** `suspicious` ou
`failed`, enquanto as demais continuarem saudáveis. O sinal aparece no resumo do
Telegram, no e-mail do Actions e em `scrape_runs` (incluindo `notes`,
`soft_blocks` e `throttle_multiplier`). Uma falha isolada não justifica escalada.

## Resposta manual

1. Confira os logs do Actions e as linhas de `scrape_runs` da plataforma. Diferencie
   um erro de credencial ou de banco de uma sequência de soft-blocks/circuit breaker.
2. Execute um lote de bootstrap local com o mesmo pipeline e o Supabase hospedado,
   como descrito em [operação de bootstrap](operacao-bootstrap.md). Se funcionar
   localmente e falhar no Actions, o IP de datacenter é a hipótese principal.
3. Antes de mudar a infraestrutura, deixe o throttle persistido agir e confirme que
   as falhas continuam no run seguinte. Não reduza o delay manualmente.
4. Se o bloqueio persistir, abra uma mudança de infraestrutura para usar um runner
   self-hosted. Essa é a primeira alternativa, pois preserva os parsers `fetch` já
   validados.
5. Considere Playwright somente se o runner self-hosted não for viável ou se o portal
   deixar de servir o conteúdo necessário ao `fetch`. Playwright não é implementado
   nem habilitado por este runbook; requer ticket, validação e decisão explícita.

O primeiro bootstrap disparado no GitHub Actions é a validação inicial do IP de
datacenter. Se ele falhar, a execução local é a contingência para concluir o
bootstrap sem esperar a decisão de infraestrutura.
