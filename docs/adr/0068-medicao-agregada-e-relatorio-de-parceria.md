# Medição agregada e relatório de parceria

## Contexto

A rota de ativação já incrementa `activation_metrics` por dia, loja canônica e plataforma. O layout
inclui Vercel Web Analytics para visualizações e estimativas de visitantes. O smoke de publicação
também segue o redirect real cinco vezes por release e, até aqui, esses requests entravam no mesmo
contador comercial.

## Decisão

Redirects validados pelo caminho público continuam no agregado diário existente. O smoke assina
timestamp, método e caminho usando o segredo já compartilhado com a invalidação interna; o servidor
reconhece apenas uma assinatura válida e grava a contagem em `activation_smoke_metrics`, sem loja,
plataforma ou evento individual. Assinaturas ausentes/inválidas são tratadas como requests públicos.

`activation_metrics_cutover.clean_from` marca o primeiro dia cujos contadores públicos não recebem
mais os cinco redirects sintéticos do smoke. O histórico anterior permanece intacto, mas é tratado
como bruto porque não é possível separá-lo com precisão.

Um gerador local, executado sob demanda, combina a consulta agregada do Supabase com o endpoint de
contagem do Vercel Web Analytics e produz um HTML estático. Ele mostra estimativas de visitantes,
visualizações, redirects comerciais por plataforma/loja, smoke excluído e histórico bruto separado.
O HTML não é publicado nem inclui eventos individuais.

Vercel Web Analytics não usa cookies, mas determina visitantes por um hash da requisição com duração
de até 24 horas. A contagem é uma estimativa de visitantes por esse provedor, não uma identificação
precisa ou duradoura de pessoas. A página de privacidade informa essa coleta.

## Consequências

`clean_from` e calculado como `current_date + 1`: o dia da migration fica no historico bruto,
pois os contadores sao diarios e nao distinguem eventos anteriores e posteriores no mesmo dia.

- O redirect público segue best-effort; falhas ao gravar telemetria não alteram o `307`.
- O schema de smoke e a data de corte ficam fora do read model público e não são acessíveis a
  `anon`, `authenticated` ou `farejo_web`.
- Relatórios que incluam dias anteriores ao corte separam os totais históricos brutos e alertam que
  eles incluem smoke; nunca os apresentam como redirects comerciais limpos.
- Cliques repetidos e automação fora do smoke ainda podem inflar os redirects públicos. Eles não são
  contagem de pessoas únicas nem prova de visita ao site da plataforma ou compra concluída.
- A telemetria de alcance começa a produzir dados apenas quando Web Analytics estiver habilitado no
  projeto Vercel de produção.
