# Hero arredonda lojas para baixo em centenas

## Contexto

O hero precisa usar a quantidade real do catálogo sem deixar a composição visual oscilar a cada loja
adicionada ou removida. Exibir o total exato, como `1.063`, produz uma estatística mais ruidosa do que
o tom resumido do handoff; manter `1.000+` fixo, por outro lado, ficaria obsoleto.

## Decisão

A fonte continua sendo a contagem exata de lojas canônicas com ao menos uma oferta pública elegível.
Somente a apresentação do hero arredonda esse total para baixo até a centena completa anterior e
adiciona `+`.

Exemplos:

- 1.063 lojas → `1.000+ lojas`;
- 1.101 lojas → `1.100+ lojas`;
- 1.199 lojas → `1.100+ lojas`;
- 1.200 lojas → `1.200+ lojas`.

Para uma eventual contagem abaixo de 100, o hero mostra o valor exato, evitando `0+ lojas`. A
formatação numérica usa locale `pt-BR`.

O total exato continua sendo usado na paginação, nos resultados de busca e em contratos internos. O
arredondamento não é persistido no banco e não altera quais lojas aparecem.

O segundo stat representa plataformas suportadas e monitoradas pelo produto, atualmente cinco. Uma
falha temporária de coleta não reduz esse número. Falha ao buscar as estatísticas aciona estado de
erro e nunca produz `0 lojas` como se fosse um valor real.

## Consequências

- O hero só muda quando o catálogo cruza uma nova centena.
- A mensagem é conservadora: nunca anuncia um patamar superior à quantidade elegível existente.
- A cache do catálogo e sua invalidação pós-scrape atualizam a contagem sem configuração manual.
- Componentes recebem o total exato e derivam separadamente a representação resumida do hero.
