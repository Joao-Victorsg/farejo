# Busca ordena primeiro por relevância

## Contexto

A ADR-0021 define classes de relevância para que nome canônico, aliases e aproximações encontrem a
loja esperada. A ADR-0047 acrescenta ao catálogo as escolhas “Mais plataformas”, “Maior cashback” e
“A–Z”. Se a ordenação comercial substituísse a relevância durante uma busca, uma correspondência
aproximada poderia aparecer antes da loja cujo nome coincide exatamente com a consulta.

## Decisão

Quando `q` não estiver vazio, a classe de relevância é sempre a primeira chave de ordenação:

1. nome canônico exato normalizado;
2. alias exato normalizado;
3. prefixo;
4. substring;
5. similaridade trigram.

A opção selecionada em `sort` é aplicada somente dentro da mesma classe de relevância. “Mais
plataformas” usa cobertura; “Maior cashback” usa a regra da ADR-0045; “A–Z” usa o nome canônico.
Empates remanescentes terminam em nome e slug para manter paginação determinística.

O controle de ordenação continua visível e sua escolha permanece na URL. A busca continua paginada
em 24 resultados quando necessário; ela não remove a paginação apenas porque `q` está presente.

## Consequências

- Uma correspondência exata nunca é escondida por uma loja apenas mais rentável ou mais coberta.
- A ordenação escolhida ainda organiza buscas com vários resultados equivalentes.
- Banco e frontend precisam compartilhar a mesma precedência para não mudar a ordem após hidratação.
- O handoff deve demonstrar que resultados de busca continuam pagináveis quando excedem 24 itens.
