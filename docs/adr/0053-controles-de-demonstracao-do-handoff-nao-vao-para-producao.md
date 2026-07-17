# Controles de demonstração do handoff não vão para produção

## Contexto

O standalone atualizado inclui no rodapé um seletor “HANDOFF · ESTADOS DO CATÁLOGO” com as opções
Normal, Carregando, Erro e Indisponível. O controle é útil para inspecionar variantes no protótipo,
mas não representa uma ação disponível para o visitante.

## Decisão

O seletor de estados e qualquer outro controle rotulado como demonstração, handoff ou debug existem
somente no artefato de design. Eles não são reproduzidos no frontend de produção, não ocupam espaço
no footer e não são expostos por query string ou configuração pública.

Os estados correspondentes continuam sendo implementados com a mesma composição visual, mas surgem
apenas a partir do estado real da aplicação. Testes podem acionar essas variantes por fixtures ou
instrumentação restrita ao ambiente de teste, sem publicar o seletor.

## Consequências

- O footer público contém somente marca, navegação e texto aprovado.
- O handoff pode continuar oferecendo navegação conveniente entre variantes.
- A implementação copia o resultado visual dos estados, não o mecanismo demonstrativo do protótipo.
- Builds de produção não carregam controles ou dados de demonstração.
