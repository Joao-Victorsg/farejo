# Card recebe todas as ofertas e resolve o top 3

## Contexto

O card da home mostra no máximo três plataformas, mas o toggle Inter pode mudar a posição da oferta
Inter no ranking interno. Se o servidor enviasse somente o top 3 calculado para correntistas, uma
quarta plataforma que deveria entrar ao desligar o toggle não estaria disponível no navegador. Fazer
uma nova consulta a cada troca adicionaria latência e uma rota desnecessária.

Como o produto compara somente cinco plataformas, o conjunto completo por loja é pequeno e limitado.

## Decisão

Cada página do catálogo entrega 24 lojas e, para cada uma, todas as ofertas públicas elegíveis — no
máximo cinco. O DTO inclui os dados de apresentação necessários para resolver os dois estados do
Inter, tipos de recompensa, sinal “até”, frescor e sinais derivados como boost, valor típico e valor
anterior quando aplicáveis.

Um componente cliente pequeno e compartilhado recebe esse DTO, escolhe `value` ou `value_partial`
para o Inter, aplica a regra de percentuais antes de valores fixos, reordena as ofertas e renderiza as
três primeiras. O total completo determina o indicador “+N mais plataformas”. A página de detalhe usa
a mesma resolução, mas exibe todas as ofertas.

Trocar o toggle não consulta o banco, não chama Route Handler, não altera a URL e não muda a página ou
a posição da loja no catálogo. Dados, shell da página, paginação e busca continuam resolvidos no
servidor; somente a preferência e o ranking interno são estado cliente.

## Consequências

- Uma página transporta no máximo 120 ofertas, um limite pequeno e previsível.
- O top 3 nunca fica incorreto por uma oferta omitida antes de conhecer a preferência local.
- Home e detalhe compartilham uma única função de ordenação e formatação.
- Os cards mantêm altura e estrutura estáveis quando as linhas trocam de posição.
- O DTO público é próprio para apresentação; ele não precisa reproduzir linhas completas de `offers`
  nem transportar campos operacionais sem uso no card.
