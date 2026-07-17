# Mobile é adiado e desktop define a primeira entrega

## Contexto

O handoff visual foi atualizado para incorporar as decisões do grill no site desktop, incluindo
catálogo completo, paginação, estados, histórico e ajustes nas páginas públicas. As composições
mobile ainda não foram desenhadas e serão tratadas como uma entrega posterior.

A ADR-0026 havia incluído mobile e acessibilidade no mesmo gate do MVP. O novo recorte não deve
transformar a ausência do handoff mobile em requisito implícito da primeira publicação, mas também
não elimina os requisitos de acessibilidade que independem do breakpoint.

## Decisão

A primeira entrega da Fase 3 tem o handoff desktop como referência visual e não é bloqueada pela
ausência de composições mobile. O design e a validação de mobile ficam explicitamente adiados para
uma entrega posterior. Esta decisão substitui somente a parte mobile da ADR-0026.

Acessibilidade continua obrigatória no site desktop: semântica correta, navegação por teclado, foco
visível, contraste, alternativas textuais e estados compreensíveis não dependem da futura entrega
mobile.

Até que o handoff mobile seja produzido, a primeira entrega não inventa uma composição mobile para
ser considerada de alta fidelidade. O comportamento em larguras menores pode permanecer apenas
funcional e seguro, sem promessa de paridade visual, e não entra no aceite visual desta entrega.

## Consequências

- A comparação de alta fidelidade da primeira entrega usa somente larguras desktop definidas pelo
  handoff atualizado.
- Ausência do design mobile não bloqueia a publicação inicial.
- O backlog precisa preservar mobile como entrega explícita, e não como ajuste cosmético implícito.
- Requisitos de acessibilidade desktop permanecem no escopo atual.
- A futura entrega mobile deve revisar navegação, cards, ranking, gráfico, paginação, estados e
  rodapé em larguras representativas.
