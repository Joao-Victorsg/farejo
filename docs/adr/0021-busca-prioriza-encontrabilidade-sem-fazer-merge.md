# Busca prioriza encontrabilidade sem fazer merge

## Contexto

A home precisa permitir encontrar qualquer loja presente no catálogo público, mesmo quando o usuário
conhece um nome usado por uma plataforma, escreve sem acentos ou comete um erro razoável. Ao mesmo
tempo, a busca não pode reutilizar similaridade textual como decisão de identidade: fuzzy matching
que mescla lojas poderia voltar a produzir comparações de cashback incorretas.

## Decisão

A busca usa `?q=` e é aplicada sobre todo o catálogo elegível antes da paginação. O índice lógico de
cada loja contém nome canônico, slug canônico e todos os nomes brutos que `store_aliases` já associa
àquela loja. Um nome alternativo recupera a loja canônica; ele nunca cria um card separado.

Consulta e termos são normalizados para tolerar caixa, acentos, espaços e pontuação. A ordenação de
resultados segue esta precedência:

1. nome canônico exato normalizado;
2. alias exato normalizado;
3. prefixo;
4. substring;
5. similaridade trigram como fallback para erros razoáveis.

Correspondências exatas, por prefixo ou substring não dependem do limiar fuzzy e nunca podem ser
suprimidas por ele. Consultas muito curtas não usam trigram, evitando resultados ruidosos. Dentro da
mesma classe de relevância, os desempates usam quantidade de plataformas, nome canônico e slug.

Fuzzy matching só recupera resultados. Ele não altera `store_aliases`, não consulta candidatos de
merge, não promove candidatos rejeitados e não modifica a loja canônica. A curadoria de identidade
continua exclusivamente no fluxo versionado definido pela ADR-0006.

Os resultados permanecem paginados em 24 lojas. Digitar atualiza `?q=` com debounce e o botão
“Buscar” submete imediatamente; qualquer mudança na consulta volta à página 1. Server Components
consultam o read model com parâmetros, sem `/api/search` e sem acesso do navegador ao Supabase.

“Loja existente”, para esse contrato, significa uma loja com ao menos uma oferta pública elegível.
Uma loja que só tenha ofertas inativas ou expiradas não aparece como se houvesse cashback disponível;
o estado vazio informa que nenhuma loja com cashback disponível corresponde à consulta.

## Consequências

- Nome canônico e nomes efetivamente usados pelas plataformas são caminhos garantidos para o mesmo
  resultado público.
- Erros de digitação podem ser tolerados sem transformar similaridade em identidade.
- A busca nunca filtra apenas a página já carregada; consulta o catálogo completo antes de paginar.
- Aliases absorvidos e slugs antigos podem continuar levando à loja canônica sem duplicar resultados.
- A qualidade precisa ser verificada com casos reais de nomes, aliases, acentos, pontuação e typos,
  incluindo lojas distintas com grafias muito próximas.
- O limiar trigram é um parâmetro de recuperação ajustável; mudar esse limiar não altera nenhuma
  decisão de merge.
