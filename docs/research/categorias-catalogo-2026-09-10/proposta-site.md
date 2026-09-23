# Categorias no catálogo — proposta para discussão

**Evolução da discussão:** João escolheu o dropdown, com botão compacto semelhante à ordenação, abaixo de “Todas as lojas” e título contextual. Ver o [plano de implementação](plano-implementacao.md), que prevalece sobre as sugestões de apresentação deste documento. A taxonomia e as classificações continuam sujeitas à curadoria.

Data: 10/09/2026. Este documento propõe comportamento e arquitetura a partir do código atual. Não substitui o frontend design nem registra uma ADR aprovada; não há implementação ou escrita no banco.

## Situação verificada

O snapshot integral contém 1.021 registros em stores, dos quais 963 elegíveis em web_read.catalog_stores. O piloto contém 50 lojas e 99 associações propostas em 16 categorias. O inventário integral não significa que a pesquisa das 1.021 lojas esteja concluída.

A home implementada tem hero com busca, título do catálogo, ordenações em botões, preferência de correntista Inter, grade de até três colunas e paginação de 24 lojas. A estrutura foi conferida no código e na imagem de referência dos testes visuais, que usa lojas fictícias e não representa conteúdo ao vivo.

Pontos de integração observados:

| Caminho | Comportamento atual | Delta necessário |
|---|---|---|
| apps/web/src/app/(catalogo)/page.tsx | Busca, metadados, estados vazios, grade e paginação | Inserir filtro de categoria, título contextual, contagem e metadados dos filtros |
| apps/web/src/components/catalog-controls.tsx | Links de ordenação preservam q e reiniciam página | Preservar categoria |
| apps/web/src/components/hero-search.tsx | Submit envia q, página 1 e ordenação padrão | Preservar categoria e ordenação no novo contrato; indicar o escopo da busca |
| apps/web/src/components/page-jump.tsx | Salta para página preservando q/sort | Preservar categoria |
| apps/web/src/lib/catalog-url.ts | CatalogRequest contém page, query e sort | Acrescentar category e serialização canônica |
| apps/web/src/lib/catalog.ts | Chama catalog_search(q, sort, page); cache com tag catalog | Incluir categoria na consulta e chave; ler facetas e contagem global |
| supabase/migrations/20260717000100_web_read_catalog_search.sql | Busca e relevância são calculadas antes de ordenação/paginação | Evoluir contrato com migration nova e filtro de categoria antes da contagem/paginação |
| apps/web/src/components/catalog-card.tsx | Todo o conteúdo do card é um único Link | Evitar inserir links de categoria dentro do link existente |
| apps/web/src/app/loja/[slug]/page.tsx | Detalhe, ranking, histórico e link Todas as lojas | Exibir categorias aprovadas como links separados do ranking |

## Experiência inicial para v1 — apresentação em revisão

**Atualização de 10/09/2026:** João não aprovou a apresentação visual do protótipo com atalhos em pílulas. As posições e os componentes descritos nesta seção são a proposta anterior, preservada para contexto, e não uma direção visual aprovada. Ver [referências reais e novas direções](referencias-navegacao.md). Os comportamentos abaixo também continuam como propostas.

Categorias amplas, com uma categoria selecionada por vez. Isso é independente da classificação: uma loja pode pertencer a várias categorias e aparecer em cada uma delas. Se houver necessidade real de seleção combinada, uma evolução pode oferecer OU entre categorias e E com o texto da busca.

Posição: uma faixa própria acima do cabeçalho da grade e abaixo do hero. Ela oferece Todas, alguns atalhos editoriais e Todas as categorias. A ordem dos atalhos deve ser estável; não chamar de populares sem medir uso. A seleção ativa deve continuar visível mesmo quando vier da lista completa. Evitar colocar 16–25 opções permanentemente na mesma linha ou comprimir os controles de ordenação e Inter.

Desktop: atalhos com ícone e nome; lista completa expandida em grade, navegável por teclado. Mobile: botão Categorias com o nome selecionado e lista expansível em fluxo, uma ou duas colunas conforme espaço. O mesmo conjunto de opções fica acessível nos dois tamanhos. Um painel modal não é necessário para a primeira entrega.

Regras propostas:

- Selecionar categoria preserva q e sort e volta à página 1.
- Buscar por nome preserva categoria e sort e volta à página 1. A busca continua sendo de lojas, não de produtos: digitar tênis não promete localizar lojas que vendem tênis. O filtro Moda ajuda nessa descoberta.
- Ordenar preserva categoria e q e volta à página 1; navegar preserva todos os filtros.
- Todas remove só categoria. Limpar busca remove só q. Limpar filtros remove q e categoria, preservando ordenação.
- Exemplo de URL: /?category=moda-acessorios&q=adidas&sort=cashback. Página 1 e ordenação padrão podem ser omitidas, conforme a convenção atual.
- Categoria desconhecida ou parâmetro repetido inválido não deve ser silenciosamente exibido como um filtro válido. Definir estado de parâmetro inválido com opção de limpar categoria, preservando entradas válidas.
- Categorias filtram lojas elegíveis; lojas sem classificação continuam em Todas. Categoria não modifica regras, valores ou elegibilidade de cashback.
- Marketplaces entram normalmente nas categorias comprovadas. Não oferecer Somente especialistas antes de pesquisar os perfis das lojas; perfil desconhecido não pode ser interpretado como especialista.
- Resultado vazio da combinação busca/categoria é um estado normal, com ações para remover cada restrição. Não reutilizar a mensagem de anomalia do catálogo global vazio.
- Contagens por categoria usam lojas distintas elegíveis que correspondem a q, antes da seleção de categoria. A soma das categorias pode exceder o total. Ordenação não muda as contagens.
- Categoria com zero resultados para a busca pode continuar visível com zero; não deve desaparecer se estiver selecionada. Todas permanece disponível.
- O número de lojas do hero deve representar o total global elegível; a contagem filtrada fica junto ao título dos resultados. Hoje o hero usa catalog.total, que também varia com a busca.

## Ícones e apresentação

Usar os ícones SVG da dependência lucide-react já instalada. Não há necessidade de desenhar, gerar imagens ou contratar um pacote de ícones. Mapear slugs a componentes importados explicitamente; não carregar uma biblioteca inteira por nomes arbitrários vindos do banco. A documentação do Lucide recomenda os componentes individuais e explica o tree shaking: [Lucide React](https://lucide.dev/guide/packages/lucide-react).

Ícones são apoio ao texto, não a única identificação. Exemplos candidatos: Shirt para Moda; ShoppingBasket para Alimentos; House para Casa; PawPrint para Pets; Plane para Viagens. Confirmar os exports na versão instalada na implementação. Ícones decorativos usam aria-hidden; seleção também se comunica por texto/estado, não apenas cor. Controles têm foco visível e área de toque adequada.

O botão que abre a lista completa informa estado expandido e região controlada; preservar Enter/Espaço e navegação nativa. Referência: [WAI-ARIA Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

No card, manter a prioridade do cashback. Não colocar 11 etiquetas em um marketplace. Na primeira versão, os filtros e o título contextual já explicam a categoria; os cards podem permanecer sem novas etiquetas. No detalhe, categorias aprovadas aparecem próximas ao cabeçalho, com opção de expandir a lista longa, fora de outros links.

## Modelo e curadoria propostos

Manter pesquisa e decisões revisáveis em Git, seguindo a abordagem existente para aliases. Separar evidências coletadas das associações aprovadas que serão publicadas.

- categories: id/slug estável, nome, ordem e estado de publicação. A apresentação associa o slug a um ícone conhecido no frontend.
- store_categories: vínculo N:N com unicidade loja/categoria e chaves estrangeiras. O read model publica apenas associações aprovadas.
- Evidência e decisão por vínculo: fonte, data de consulta, resumo, método de acesso, status e justificativa da revisão. Não expor payloads de pesquisa na leitura pública.
- Perfil comercial separado: abrangência generalista/especializado e opera marketplace com estado desconhecido explícito. Não derivar perfil apenas pela quantidade de categorias.
- Nova loja entra no catálogo elegível normalmente e em uma fila de pesquisa. Sem classificação ainda não significa loja inválida.
- Fontes compartilhadas podem ser reutilizadas com identidade e escopo comprovados. Nomes semelhantes, empresas do mesmo grupo e canais distintos não autorizam copiar associações automaticamente.
- Merge de aliases precisa remapear associações aprovadas ao sobrevivente, deduplicar vínculos e preservar proveniência. Conflitos de escopo ou decisão exigem revisão; a pesquisa de categorias não executa merges.
- Aplicação futura: validar manifesto e vínculos, gerar diff com adições/remoções, aplicar atomicamente a revisão aprovada e invalidar a tag catalog. Manter revisão/hash para idempotência e auditoria.
- Leitura continua no servidor com farejo_web e objetos web_read. Não introduzir acesso direto do navegador às tabelas nem service_role no frontend. Permissões devem seguir o padrão efetivo das migrations do projeto.

Para leitura, filtrar por EXISTS (ou relação previamente deduplicada) antes de relevância/contagem/paginação evita multiplicar uma loja por suas várias categorias. A contagem usa o mesmo conjunto elegível da consulta. O contrato de catalog_search deve evoluir de forma compatível com a implantação coordenada: preparar função/assinatura nova, atualizar cliente e depois retirar contrato antigo, se necessário.

A categoria precisa fazer parte da chave de cache. Facetas, detalhe e contagem global continuam usando a tag catalog; uma publicação de categorias também deve invalidá-la, independentemente de haver novo scrape.

SEO proposto para v1: filtros via query string com noindex, follow, incluindo a categoria e combinações. Não gerar automaticamente centenas de páginas indexáveis de combinações. Páginas editoriais por categoria podem ser uma entrega posterior com conteúdo e intenção de busca próprios.

## Pesquisa do catálogo completo

Escopo: todos os 1.021 registros do snapshot, inclusive 58 sem elegibilidade pública naquele instante. Priorizar os 963 elegíveis, preservando os demais no levantamento para não reiniciar a pesquisa quando voltarem ao catálogo.

1. Fechar a profundidade inicial e ampliar a taxonomia para cobrir os segmentos reais do inventário. Categorias amplas são a proposta de partida; os 16 grupos do piloto não são um teto.
2. Reaproveitar o piloto com proveniência, registrar alterações de identidade desde sua captura e organizar os restantes em lotes retomáveis de 50.
3. Obter candidatos por fontes públicas das plataformas e, quando necessário, por site oficial/departamentos da loja. Toda proposta deve ter evidência, sem completar pelo nome para atingir 100%.
4. Inspecionar categorias secundárias e perfil comercial. Registrar bloqueios, disponibilidade regional e diferenças entre canais; não converter bloqueio de acesso em ausência de segmento.
5. Revisar por lote as associações e lacunas. A saída legítima pode ser inconclusiva com motivo; cobertura de pesquisa não equivale a cobertura de classificação.
6. Publicar apenas decisões aprovadas, acompanhando lojas sem classificação, associações corrigidas e cobertura dos resultados de busca. Reavaliar fontes alteradas, novas lojas e casos sinalizados; não acoplar pesquisa externa a cada render nem ao cron de cashback duas vezes ao dia.

O harness da pesquisa deve guardar checkpoint por loja/fonte, cache de conteúdo público por URL, datas de consulta, tentativas e erros. Respeitar os limites por domínio do projeto, ter orçamento de requests e não utilizar endpoints privados. Avaliar propostas com um conjunto revisado que inclua generalistas, especialistas, cauda e casos ambíguos; não usar confiança autodeclarada como medida de precisão.

## Lacunas já verificadas nesta expansão

Estas são sondagens de escopo, não três classificações completas novas:

| Loja no inventário | Evidência pública examinada | Implicação editorial |
|---|---|---|
| Ri Happy | [Departamento de brinquedos](https://www.rihappy.com.br/brinquedos-para-criancas-e-bebes/d), busca indexada em 10/09 | Avaliar categoria Brinquedos; não obrigar tudo a entrar em jogos digitais |
| eÓtica | [Site oficial](https://www.eotica.com.br/), busca indexada em 10/09, catálogo de lentes e óculos | Avaliar Óticas e os limites entre Moda e Saúde |
| Bulbe Energia | [Site oficial](https://bulbeenergia.com.br/), busca indexada em 10/09, assinatura de energia | Definir onde entram serviços e utilidades, sem classificar como hardware solar |

Também há nomes no inventário que demandam avaliar fronteiras de transporte/mobilidade, conteúdo editorial, apostas, bem-estar íntimo e serviços profissionais. Essas observações de nomes são pistas para pesquisa, não categorias atribuídas ou conclusões sobre as empresas.

## Validação da futura implementação

- Banco: uma loja em várias categorias aparece uma vez; filtro e contagem consideram todo o catálogo antes dos 24 itens; q + categoria combinam corretamente; elegibilidade e ordenações preservadas.
- Contrato de URL: troca de categoria, busca, ordem, página, salto e voltar/avançar; normalização e valores inválidos.
- Cache: publicar associação altera filtro, contagem e detalhe após invalidação, sem esperar o próximo scrape.
- Interface: desktop e mobile, teclado, estado selecionado, expansão e vazio filtrado; sem links aninhados nos cards.
- Regressão de produto: porcentagem e valor fixo continuam separados; toggle Inter continua reordenando ofertas, não páginas de lojas.

Sequência sugerida: fechar categorias amplas/subcategorias e interação; pesquisar e revisar os lotes; consolidar ADR e frontend design; implementar persistência/read model; entregar filtro responsivo e ícones; validar e publicar as associações aprovadas.
