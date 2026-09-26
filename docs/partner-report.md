# Relatório de alcance e redirecionamentos

O gerador produz um HTML local, estático e pronto para compartilhar. Ele combina a contagem agregada
de pageviews/visitantes do Vercel com os redirects diários do Supabase.

## Preparar os dados

1. No SQL Editor do Supabase de produção, execute
   [`apps/web/scripts/partner-report-export.sql`](../apps/web/scripts/partner-report-export.sql) e
   exporte o resultado como CSV.
2. Crie um token Vercel com leitura de Web Analytics e disponibilize localmente
   `VERCEL_TOKEN`, `VERCEL_TEAM_ID` e `VERCEL_PROJECT_ID`. Não grave esses valores no repositório.
3. Execute o gerador com o CSV e as datas inclusivas do relatório:

```powershell
pnpm --filter @farejo/web report:partners -- --since 2026-09-01 --until 2026-09-24 --redirects .\activation-metrics.csv
```

O padrão salva o arquivo em `apps/web/reports/partner-reports/`, ignorado pelo Git. Use `--out`
para indicar outro caminho.

Se o Vercel responder `401`/`403`, revise o token e o acesso à equipe/projeto. Se a resposta não
trouxer visitantes/pageviews, habilite Web Analytics em produção e gere o relatório depois que houver
dados disponíveis. Não substitua um período sem dados por zero estimado manualmente.

## Como interpretar

- **Visitantes estimados** e **visualizações** vêm do Vercel. A estimativa de visitantes usa o modelo
  agregado do provedor; não é uma lista de pessoas identificadas.
- **Redirecionamentos validados** são respostas `307` após revalidar uma oferta vigente, agrupadas por
  loja e plataforma. Não confirmam abertura no destino ou compra.
- Redirects de smoke são contados em separado e excluídos do total comercial. Dados anteriores à
  data de corte aparecem como históricos brutos, pois incluem checks automáticos sem classificação
  individual disponível.

O site já carrega `@vercel/analytics/next`; o painel só começa a receber pageviews quando a coleta de
Web Analytics estiver habilitada no projeto Vercel de produção. A data de corte começa no dia seguinte
à aplicação da migration; o restante do dia fica no histórico bruto.
