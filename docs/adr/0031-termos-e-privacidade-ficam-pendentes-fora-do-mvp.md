# Termos e Privacidade ficam pendentes fora do MVP

## Contexto

O rodapé do handoff atual contém links para páginas de Termos e Privacidade, mas as rotas confirmadas
do MVP são `/`, `/loja/[slug]`, `/plataformas`, `/como-funciona` e `/faq`. Manter links sem destino ou
publicar páginas vazias criaria navegação quebrada e conteúdo sem revisão apropriada.

Esta decisão trata somente do escopo e da integridade da interface; não substitui uma avaliação
jurídica sobre o que será necessário na publicação.

## Decisão

Os links “Termos” e “Privacidade” e a coluna “Legal” não aparecem no rodapé do MVP. O espaço é
reorganizado preservando a composição visual do restante do footer, sem links desabilitados, âncoras
vazias ou rotas inexistentes.

As duas páginas ficam marcadas como pendência futura. Quando entrarem em escopo, conteúdo, rotas,
dados tratados pelo produto e requisitos aplicáveis serão revisados especificamente antes da
publicação.

## Consequências

- O MVP mantém apenas links que levam a destinos implementados.
- A atualização do handoff precisa remover a coluna “Legal” e reequilibrar o rodapé.
- Nenhum texto provisório é apresentado como política ou termo definitivo.
- **Pendente futura:** avaliar, redigir, revisar e publicar Termos e Privacidade em escopo próprio.
