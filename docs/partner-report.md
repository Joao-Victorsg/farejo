# Relatório de alcance e redirecionamentos

O gerador cria um HTML local, estático e pronto para compartilhar. Ele combina estimativas agregadas do Vercel, etapas agregadas do GA4 (quando exportadas) e redirects diários do Supabase. Não consulte nem exporte usuários/eventos individuais.

## Preparar os dados

1. No SQL Editor do projeto Farejo no Supabase, execute [`apps/web/scripts/partner-report-export.sql`](../apps/web/scripts/partner-report-export.sql) e exporte o resultado como `activation-metrics.csv`.
2. Crie um token Vercel com leitura de Web Analytics e disponibilize localmente `VERCEL_TOKEN`, `VERCEL_TEAM_ID` e `VERCEL_PROJECT_ID`. Não grave esses valores no repositório.
3. No GA4, abra as Explorações e exporte somente contagens agregadas. Copie os valores para o formato de [`apps/web/scripts/ga4-partner-export.example.csv`](../apps/web/scripts/ga4-partner-export.example.csv): datas inclusivas do período, métrica, usuários ativos, contagem de eventos e, se aplicável, loja/plataforma ou `result_bucket`. Para `store_page_view`, filtre o evento `page_view` pela dimensão personalizada `store_slug`; para os redirects, filtre `activation_redirect` e use `store_slug` e `platform_id`. Para resultados, filtre `search_results_view` e exporte por `result_count_bucket` (`0`, `1`, `2-5`, `6+`) na coluna `result_bucket`. Use inteiros sem separador de milhar. Não inclua termos de busca, client IDs, session IDs ou linhas individuais. Métricas sem valor devem ser omitidas (o relatório mostrará “—”, não zero).
4. Informe a data em que a coleta GA4 de produção começou. Ela serve para identificar períodos anteriores à cobertura do GA4.

```powershell
pnpm --filter @farejo/web report:partners -- --since 2026-10-01 --until 2026-10-31 --redirects .\activation-metrics.csv --ga4 .\ga4-partner.csv --ga4-started-on 2026-09-30
```

O CSV GA4 é opcional. Sem ele, o relatório mostra que o funil não foi fornecido, sem apresentar métricas GA4 como zero. O padrão salva o arquivo em `apps/web/reports/partner-reports/`, ignorado pelo Git. Use `--out` para indicar outro caminho.

Se o Vercel responder `401`/`403`, revise token e acesso à equipe/projeto. Se a resposta não trouxer visitantes/pageviews, habilite Web Analytics em produção e gere o relatório depois que houver dados. Não substitua um período sem dados por zero estimado manualmente.

## Como interpretar

- **Visitantes estimados** e **visualizações** vêm do Vercel, cuja contagem agregada continua independente do aceite do GA4.
- **Usuários ativos no GA4**, buscas, páginas de loja e redirects cobrem somente sessões que aceitaram analytics. Os identificadores do Google não são copiados para o CSV nem para o relatório.
- A busca é contada sem o termo pesquisado. “Usuários que pesquisaram” é uma métrica separada, não uma etapa obrigatória do funil principal.
- `search_results_view` conta visualizações da primeira página de resultados, agrupadas pela quantidade de lojas. A porcentagem sem resultado usa somente essas visualizações consentidas como denominador; não representa todas as buscas nem visitantes únicos.
- **Redirects validados** no Supabase são respostas `307` após revalidar uma oferta vigente, agrupadas por loja e plataforma. Não confirmam abertura no destino nem compra.
- O evento GA4 `activation_redirect` é enviado somente após validação e resposta `307`, e representa a sessão pseudônima que aceitou analytics. Também não confirma que a plataforma carregou.
- Redirects de smoke ficam separados e excluídos do total comercial. Dados anteriores à data de corte aparecem como histórico bruto, pois incluem verificações automáticas sem classificação individual.
- Dados GA4 anteriores à data de início informada não são reconstruídos retroativamente.

## Configurar e aprender GA4

1. Crie uma propriedade GA4 e um fluxo Web para `https://www.farejo.site`. Use UTC como fuso para manter o mesmo limite diário dos agregados do Supabase.
2. Em **Administração → Fluxos de dados → fluxo Web → Medição otimizada**, desative a medição otimizada. O Farejo envia pageviews e buscas manualmente; assim evita duplicações, cliques automáticos fora do funil e o envio automático do parâmetro `q` como termo de busca.
3. Copie o Measurement ID para `NEXT_PUBLIC_GA4_MEASUREMENT_ID`. Em **Medição via protocolo → Segredos da API**, crie o segredo e cadastre-o como `GA4_API_SECRET` server-side na Vercel. Defina as duas variáveis apenas no ambiente **Production**; depois faça um novo deploy. Não configure o segredo como variável pública.
4. Em **Configurações de dados → Retenção de dados**, use 14 meses para dados de evento/usuário, dando suporte a uma janela anual. Os cookies do GA4 expiram após 90 dias desde atividade mais recente; a preferência de consentimento expira após 180 dias.
5. Em **Administração → Definições personalizadas**, registre as dimensões de evento `store_slug`, `platform_id` e `result_count_bucket`. O Farejo envia `store_slug` em `page_view` somente quando a rota é `/loja/{slug}` e nunca envia a query string. Se o GA4 agrupar valores em “(other)”, filtre por uma loja específica; os totais por loja/plataforma do Supabase continuam sendo a fonte comercial completa.
6. Use **Relatórios → Tempo real** e **Administrador → Exibição de dados → DebugView** para aprender a localizar `page_view`, `search` e `activation_redirect`. Em **Explorar → Exploração de funil**, configure início de sessão → `page_view` com `store_slug` definido → `activation_redirect`; exporte somente a tabela agregada. Use uma exploração livre para métricas de busca ou detalhamento por loja.

Em desenvolvimento, os eventos do Google Tag e Measurement Protocol recebem `debug_mode`. Em produção, o GA4 só carrega após consentimento explícito. A propriedade deve permanecer sem funções de publicidade/personalização; a única finalidade é analytics.
