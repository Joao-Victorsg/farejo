# Catálogo completo é paginado por cobertura de plataformas

## Contexto

O handoff original sugeria uma ordenação “Populares”, mas o produto ainda não possui um sinal real
de popularidade. Uma seleção editorial também esconderia parte do catálogo e enfraqueceria o valor
principal do farejô: permitir encontrar qualquer loja para a qual exista cashback público elegível.

A quantidade de plataformas que oferecem cashback para uma mesma loja já é um dado objetivo. Ela
mede onde a comparação é mais rica, sem alegar popularidade nem comparar diretamente recompensas em
percentual com valores fixos.

## Decisão

A home lista todas as lojas canônicas que tenham ao menos uma oferta pública elegível. Para essa
consulta, uma oferta é elegível quando está ativa e ainda não expirou pela política de frescor da
ADR-0015; ofertas frescas e atrasadas dentro da tolerância de 48 horas contam, ofertas expiradas não.

O catálogo usa paginação numerada no servidor, inicialmente com 24 lojas por página. Busca e página
fazem parte da URL, por exemplo `/?q=amazon&page=2`. A busca é aplicada sobre todo o catálogo antes da
paginação; uma nova busca volta à primeira página.

A ordem padrão é estável e segue:

1. quantidade decrescente de plataformas distintas com oferta pública elegível;
2. nome canônico em ordem alfabética;
3. slug canônico como desempate final.

A contagem acontece depois da resolução dos aliases. Uma loja presente em apenas uma plataforma
continua sendo um resultado normal; ela apenas aparece depois das lojas com maior cobertura. O valor
pode ser derivado no read model e não exige uma coluna persistida de popularidade.

“Populares” não é nome nem conceito funcional da primeira entrega. Ordenações futuras por boost ou
popularidade serão sinais separados e não alteram o significado da cobertura inicial. O handoff será
atualizado para remover a indicação incorreta.

## Consequências

- Nenhuma loja elegível fica escondida por uma lista editorial ou por ausência de telemetria.
- A primeira página concentra comparações mais completas sem afirmar que são as lojas mais usadas.
- A curadoria correta de aliases afeta diretamente a cobertura e, portanto, a posição no catálogo.
- O frontend busca somente a página necessária e a contagem total, em vez de enviar todo o catálogo
  ao navegador.
- URLs de busca e paginação podem ser compartilhadas, recarregadas e navegadas com os controles do
  browser.
- A ordenação alfabética e o slug evitam paginação não determinística entre lojas com a mesma
  quantidade de plataformas.
- Não é necessário coletar cliques para sustentar a ordenação inicial.
