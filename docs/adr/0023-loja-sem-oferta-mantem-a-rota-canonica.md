# Loja sem oferta mantém a rota canônica

## Contexto

Uma loja canônica pode continuar existindo mesmo quando todas as suas ofertas estão inativas ou
expiraram pela política de frescor. Tratar essa indisponibilidade temporária como loja inexistente
quebraria links salvos, apagaria o acesso ao histórico verdadeiro e faria a mesma URL oscilar entre
existência e `404` conforme os scrapes.

Slugs desconhecidos e slugs absorvidos durante a curadoria de aliases têm semânticas diferentes e
não devem cair no mesmo estado vazio.

## Decisão

`/loja/[slug]` distingue três casos:

1. slug que nunca correspondeu a uma loja conhecida: responde `404`;
2. slug absorvido por outra loja: redireciona permanentemente para o slug canônico;
3. loja canônica existente, mas sem oferta pública elegível: responde `200` com um estado explícito
   de “Nenhum cashback disponível no momento”.

A loja indisponível não aparece no catálogo, na busca ou nas estatísticas públicas. Sua página não
exibe melhor oferta nem botão “Ativar”. Nome, logo e histórico verdadeiro podem continuar visíveis;
o gráfico segue as regras de suficiência já definidas e nunca inventa uma série para preencher o
estado.

Enquanto não houver oferta elegível, os metadados da página incluem `noindex`. Quando uma oferta
voltar, a invalidação do catálogo remove automaticamente o estado indisponível e a restrição de
indexação.

Falha de leitura do banco não é tratada como nenhum desses casos: ela aciona o estado de erro da rota
e não produz `404` nem afirma que a loja está sem cashback.

## Consequências

- Links canônicos permanecem estáveis durante indisponibilidades temporárias.
- Slugs antigos consolidam autoridade e navegação na loja correta por redirecionamento permanente.
- O catálogo continua obedecendo à regra de não anunciar lojas sem cashback disponível.
- Histórico real pode explicar que uma loja já teve oferta sem habilitar uma ativação inválida.
- SEO não indexa como resultado útil uma página temporariamente vazia, mas a identidade da rota é
  preservada para recuperação futura.
- Estados de vazio, ausência e erro precisam de componentes e testes distintos.
