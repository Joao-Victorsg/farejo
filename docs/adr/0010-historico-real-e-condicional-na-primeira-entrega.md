# Histórico real e condicional na primeira entrega

## Contexto

O system design inclui histórico na página da loja, mas o handoff visual inspecionado em
14/07/2026 ainda não apresenta o gráfico. O handoff será atualizado pelo mantenedor; até essa
atualização, não existe referência visual autoritativa para composição, dimensões ou estilo do
gráfico. Ainda assim, o contrato de dados precisa ser fechado na Fase 3 porque histórico é parte da
primeira entrega.

## Decisão

`/loja/[slug]` inclui uma seção de histórico abaixo do ranking de ofertas. A janela inicial é de 60
dias e a visualização é em degraus, refletindo que cashback mantém um valor até o próximo evento.
Somente eventos reais de `offer_history` participam; não há dados demonstrativos, interpolação ou
valor anterior inventado.

A leitura da janela inclui o último evento anterior ao início dos 60 dias como âncora, quando ele
existe, seguido dos eventos dentro da janela. Sem essa âncora, o gráfico representaria falsamente
que a série começou apenas na primeira mudança ocorrida no período. Desativação produz lacuna, não
linha em zero.

Quando não existir histórico suficiente para mostrar ao menos uma mudança real, a seção exibe um
estado discreto “Histórico sendo construído” em vez de um gráfico vazio ou fabricado. A ausência de
histórico não afeta o ranking atual nem é tratada como erro da loja.

Percentuais e valores fixos nunca compartilham escala numérica. Se uma loja possuir ambos, a
apresentação os separa; a composição exata será reconciliada com o novo handoff.

## Handoff reconciliado

O handoff desktop atualizado em 16/07/2026 integra a seção abaixo do ranking, com título, janela de
60 dias, legenda por plataforma, gráfico em degraus e resumo textual. Essa composição passa a ser a
referência visual desktop. Mobile permanece sujeito à entrega posterior definida na ADR-0044.

A demonstração do handoff pode usar séries ilustrativas para documentar o componente; a produção
continua proibida de fabricar ou interpolar histórico.

## Consequências

- O contrato público de detalhe precisa retornar eventos ordenados, âncora anterior à janela e
  indicação explícita de dados insuficientes.
- O gráfico não aparece em cards, home ou página de plataformas.
- Dados delta-based são suficientes; não é necessário gerar snapshots diários.
- Mudança entre `percent` e `fixed` quebra a continuidade visual da série.
- Loading, erro e ausência de histórico são estados diferentes e não podem usar a mesma mensagem.
