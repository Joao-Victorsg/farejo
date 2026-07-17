# Larguras menores têm reflow funcional antes do handoff mobile

## Contexto

A ADR-0051 exclui larguras abaixo de 1024 pixels do aceite de alta fidelidade atual. Entretanto,
zoom de 200% em um desktop comum reduz a largura CSS disponível para uma faixa semelhante à de
tablet ou celular. Tratar toda largura menor como indisponível impediria uso acessível antes da
entrega do handoff mobile.

## Decisão

A primeira entrega exige reflow funcional e acessível abaixo de 1024 pixels. Conteúdo, navegação,
busca, cards, ranking, gráfico, paginação, estados e CTAs permanecem legíveis e operáveis, sem corte
ou rolagem horizontal da página.

Esse requisito não define alta fidelidade mobile. Distribuição, densidade, composição, navegação e
refinamentos visuais dessas larguras podem ser substituídos quando o handoff mobile for entregue. O
aceite visual continua restrito ao desktop conforme a ADR-0051.

Zoom até 200%, tamanho de texto aumentado, teclado, foco visível e tecnologias assistivas continuam
no aceite atual. Nenhuma informação essencial pode desaparecer apenas porque o layout entrou no
reflow provisório.

## Consequências

- Adiar o design mobile não cria uma página inutilizável em zoom ou telas menores.
- A implementação precisa de breakpoints funcionais, mas não de reprodução visual mobile ainda não
  desenhada.
- Testes de acessibilidade podem usar larguras menores sem transformá-las em snapshots de
  fidelidade.
- O futuro handoff mobile pode redesenhar o reflow sem mudar conteúdo ou comportamento do produto.
