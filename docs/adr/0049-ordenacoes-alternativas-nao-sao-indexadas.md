# Ordenações alternativas não são indexadas

## Contexto

A ADR-0033 torna indexáveis as páginas numeradas do catálogo padrão e mantém buscas fora do índice.
Com a ADR-0047, o mesmo conjunto de lojas também pode ser apresentado por maior cashback ou em ordem
alfabética. Indexar essas combinações multiplicaria páginas com conteúdo equivalente em sequências
diferentes.

## Decisão

Somente o catálogo na ordem padrão “Mais plataformas” é indexável. A URL omite `sort`; uma requisição
com `sort=platforms` é normalizada para a equivalente sem o parâmetro, preservando `page` e `q`
quando aplicáveis.

URLs com `sort=cashback` ou `sort=az`, inclusive suas páginas seguintes, recebem `noindex,follow` e
não entram no sitemap. Elas continuam renderizáveis, navegáveis e compartilháveis.

Qualquer URL que contenha uma busca não vazia em `q` continua `noindex,follow`, independentemente da
ordenação. Valores de `sort` desconhecidos são tratados como a ordem padrão e normalizados para não
criar variantes adicionais.

## Consequências

- Buscadores não recebem três cópias ordenadas do mesmo catálogo.
- Usuários preservam links para a visualização escolhida.
- Paginação alternativa precisa manter links reais, embora não seja indexável.
- Canonical, robots e metadados precisam ser derivados da ordenação efetiva, não apenas da rota.
