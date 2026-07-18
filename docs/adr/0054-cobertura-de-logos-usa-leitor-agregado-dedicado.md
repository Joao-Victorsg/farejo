# Cobertura de logos usa leitor agregado dedicado

## Contexto

A ADR-0043 exige medir automaticamente se ao menos 95% das lojas públicas elegíveis têm logo final
antes do lançamento. "Elegível" é definido ali como loja com ao menos uma oferta pública — hoje só
`public.offers` sabe responder isso, e a mesma janela de frescor do catálogo público decide o que
conta.

A ADR-0042 deu à Action de logos a role `farejo_logo_writer`, deliberadamente sem acesso a ofertas,
aliases ou histórico — só `store_logo_sources` e as colunas `logo_url`/`logo_hash` de `stores`. Medir
a meta de 95% não pode exigir abrir `public.offers` para essa role só para contar linhas: isso
alargaria um limite de acesso já documentado e validado, sem que a Action de ingestão precise desse
acesso para o próprio trabalho de baixar, normalizar e publicar logos.

## Decisão

A cobertura é medida por uma role nova, `farejo_logo_coverage`, somente leitura, que enxerga apenas
uma view agregada: `web_read.logo_coverage`, com exatamente duas colunas (`eligible_stores`,
`stores_with_logo`). A view é derivada de `web_read.catalog_stores` — a mesma view que já define
publicamente quais lojas aparecem no catálogo — em vez de reimplementar o filtro de elegibilidade
num segundo lugar.

Nenhum grant novo chega a `farejo_logo_writer`; a ADR-0042 continua descrevendo essa role sem
qualquer alteração. `farejo_logo_coverage` nunca lê uma linha de oferta, apenas duas contagens já
agregadas — a mesma proporção fica observável navegando o catálogo público (quantas lojas mostram
logo real contra quantas caem no avatar de fallback), então esta view não expõe informação nova, só
poupa o trabalho de contar manualmente.

O script `logos:coverage` roda como um passo separado no workflow de logos (`pnpm --filter
@farejo/scraper logos:coverage`), sempre depois da ingestão, com sua própria credencial de banco
(`FAREJO_LOGO_COVERAGE_DATABASE_URL`, secret independente do `FAREJO_LOGO_WRITER_DATABASE_URL`). É
best-effort: se o secret ainda não existir (mesma pendência operacional do Environment `logos`), o
passo avisa e não falha — o mesmo padrão já usado pelo resumo do Telegram. A métrica é só
diagnóstico: nunca falha o job de ingestão, nunca bloqueia uma troca de ponteiro, nunca reclassifica
uma loja já processada.

## Consequências

- ADR-0042 permanece válida sem revisão; a Action de ingestão de logos continua sem qualquer
  visibilidade sobre ofertas.
- Uma quarta credencial passa a existir para o ciclo de logos (banco de escrita, S3, invalidação de
  catálogo, agora leitura de cobertura), todas com escopo mínimo e independente.
- A definição de "elegível" para a meta de 95% nunca diverge da definição de "aparece no catálogo
  público", porque a view de cobertura é derivada da mesma fonte.
- Um novo bucket ou tabela sensível futura não herda acesso nenhum por causa desta role — ela só
  enxerga a view agregada, nada além dela.
