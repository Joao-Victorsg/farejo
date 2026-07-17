# Mobile e acessibilidade são requisitos do MVP

## Contexto

O protótipo de referência define com precisão a composição desktop, mas não implementa o
comportamento responsivo. Apenas reduzir os mesmos elementos produziria overflow no ranking,
controles pequenos e informações dependentes de hover. Mobile e acessibilidade, portanto, precisam
ser tratados como parte da fidelidade do MVP, não como acabamento posterior.

## Decisão

O catálogo usa três colunas em desktop, duas em tablet e uma em mobile, mantendo 24 resultados por
página. Como referência inicial, os intervalos são mobile abaixo de 640 px, tablet de 640 a 1023 px
e desktop a partir de 1024 px; ajustes finos podem acompanhar os pontos reais em que o conteúdo
deixar de caber.

No mobile, hero, filtros, cabeçalho de loja e rodapé empilham sem rolagem horizontal. A navegação
global usa um menu acessível. Cada linha do ranking se reorganiza verticalmente para preservar nome,
selos, valor e CTA, e o gráfico se adapta à largura disponível.

Controles de toque têm área mínima de 44 px. Busca, paginação e toggle permanecem rotulados e
operáveis por teclado e tecnologia assistiva. Links são elementos de navegação reais; botões são
reservados para ações. O foco por teclado é sempre visível, existe acesso direto ao conteúdo
principal e nenhuma informação depende exclusivamente de hover, cor ou tooltip.

Boost, valor anterior, condição do Inter, frescor e abertura em nova aba possuem alternativa textual
compreensível. O gráfico oferece resumo textual acessível. Imagens têm dimensões reservadas e texto
alternativo apropriado; logos decorativos não repetem nomes já anunciados.

Animações respeitam `prefers-reduced-motion`, evitam transições genéricas e não são necessárias para
entender mudanças de estado. Mensagens assíncronas relevantes usam anúncio não intrusivo sem mover o
foco arbitrariamente.

## Consequências

- O handoff atualizado precisa especificar composições mobile, não somente indicar que a grade
  colapsa.
- A densidade visual pode mudar entre breakpoints, mas conteúdo, ordem semântica e comportamento não.
- Tooltips nunca são a única forma de acessar valor anterior, motivo do boost ou frescor.
- Testes do MVP incluem teclado, zoom, redução de movimento, leitores de tela em fluxos críticos e
  larguras representativas.
- Os 24 itens por página mantêm o mesmo contrato; somente a quantidade de colunas muda.
