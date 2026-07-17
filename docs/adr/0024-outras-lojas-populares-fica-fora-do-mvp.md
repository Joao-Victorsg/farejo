# “Outras lojas populares” fica fora do MVP

## Contexto

O detalhe de loja do handoff atual termina com uma grade de quatro cards chamada “Outras lojas
populares”. O MVP ainda não possui categorias, relações entre lojas ou amostra suficiente das
ativações agregadas para produzir uma recomendação verdadeira. Preencher a seção com lojas
aleatórias ou repetir as de maior cobertura daria aparência de personalização a uma regra sem
significado para aquela loja.

Essa seção é distinta do catálogo principal da home, que continua completo e paginado conforme a
ADR-0016.

## Decisão

A grade “Outras lojas populares” não faz parte do MVP da Fase 3 e deve ser removida na atualização do
handoff. O detalhe pode oferecer um CTA simples de retorno ao catálogo, sem simular recomendação.

A funcionalidade fica marcada como pendência pós-MVP. Ela só será reavaliada quando existir um sinal
adequado para selecionar lojas, como popularidade com amostra suficiente, categorias reais, boosts
relevantes ou outra relação de produto explicitamente definida.

Não se define agora algoritmo, layout, janela de popularidade ou fonte de recomendação. Essas
decisões pertencem à versão que voltar a colocar a funcionalidade em escopo.

## Consequências

- O MVP não exibe recomendações arbitrárias ou rotuladas incorretamente como populares.
- A home continua mostrando todas as lojas elegíveis; somente a grade complementar do detalhe sai.
- Os dados de ativações da ADR-0017 continuam sendo acumulados, mas não alimentam essa seção durante
  o MVP.
- O handoff atualizado precisa remover o título e os quatro cards relacionados.
- **Pendente pós-MVP:** reavaliar recomendações de outras lojas quando houver fonte e critérios reais.
