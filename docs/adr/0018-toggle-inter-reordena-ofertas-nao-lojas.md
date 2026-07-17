# Toggle Inter reordena ofertas, não lojas

## Contexto

O handoff antigo afirma que o toggle “Correntista Inter” faz a grade reordenar ao vivo. Essa frase é
ambígua: pode significar reordenar as plataformas dentro de cada loja ou mudar a posição das lojas no
catálogo. A segunda interpretação conflitaria com a paginação estável e com a ordenação padrão por
quantidade de plataformas definida na ADR-0016.

## Decisão

O toggle Inter altera somente o valor efetivo da oferta Inter entre `value` para correntista e
`value_partial` para não correntista. Depois da troca, as ofertas são reordenadas dentro de cada loja.

Na home, isso pode mudar a ordem das linhas de plataforma do card, quais três ofertas aparecem, qual
linha recebe “MELHOR” e o melhor valor mostrado para aquela loja. No detalhe, muda a ordem do ranking
completo e os mesmos destaques. A regra de percentuais antes de valores fixos continua valendo.

O toggle não altera a ordem das lojas, a página em que uma loja aparece, a contagem de plataformas
nem a paginação do catálogo. A posição da loja permanece determinada pela cobertura de plataformas,
nome canônico e slug.

A preferência continua ligada por padrão, persiste localmente e vale na home e no detalhe. O novo
handoff deve substituir a expressão genérica “a grade reordena” por uma descrição explícita da
reordenação das ofertas de cada loja.

## Consequências

- A preferência pode ser aplicada no cliente aos dois valores já entregues pelo servidor sem refazer
  a consulta ou a paginação do catálogo.
- Trocar o toggle não muda a URL nem provoca salto de cards entre páginas.
- Os cards precisam receber dados suficientes para recalcular o ranking interno, inclusive ofertas
  que possam entrar ou sair do recorte das três primeiras.
- A página de detalhe usa a mesma função de resolução e ordenação da home, evitando divergência entre
  os dois rankings.
