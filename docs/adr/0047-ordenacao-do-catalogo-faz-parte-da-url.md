# Ordenação do catálogo faz parte da URL

## Contexto

Busca e paginação já fazem parte da URL pública do catálogo. O handoff também oferece três ordens:
“Mais plataformas”, “Maior cashback” e “A–Z”. Manter a ordenação apenas em estado local faria um
recarregamento ou link compartilhado voltar silenciosamente para a ordem padrão.

## Decisão

A ordenação é representada pelo parâmetro `sort`:

- `sort=platforms` para “Mais plataformas”;
- `sort=cashback` para “Maior cashback”;
- `sort=az` para “A–Z”.

“Mais plataformas” é a ordem padrão. O parâmetro pode ser omitido quando essa opção estiver ativa,
e a URL canônica normaliza valor ausente ou inválido para o padrão.

Trocar a ordenação preserva a busca atual e retorna para a página 1. Trocar busca ou página preserva
a ordenação selecionada. Voltar, avançar, recarregar e compartilhar a URL reproduzem o mesmo estado
do catálogo.

## Consequências

- Links podem representar busca, página e ordenação sem estado oculto.
- O servidor renderiza diretamente a ordem solicitada.
- Valores inválidos não criam variantes indefinidas de conteúdo.
- O controle visual precisa refletir o parâmetro efetivo da URL.
- Cache e canonicalização precisam tratar a ordem padrão omitida e `sort=platforms` como o mesmo
  estado lógico.
