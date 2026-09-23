# Categorias de lojas — plano de implementação

Status: plano proposto. A direção visual do dropdown foi escolhida por João nesta conversa, com os ajustes abaixo. A escolha não aprova automaticamente a taxonomia, as classificações individuais ou os detalhes técnicos deste plano. Nenhuma implementação, migration ou escrita remota foi feita nesta etapa.

## 1. Resultado esperado e decisões já recebidas

O visitante consegue descobrir lojas por assunto e comparar as ofertas usando o catálogo existente. Uma loja pode pertencer a várias categorias, inclusive marketplaces, quando há evidência de que comercializa aqueles produtos ou serviços.

Direção visual escolhida:

- Dropdown integrado ao catálogo; a página própria de exploração da alternativa B fica fora desta entrega.
- Botão compacto, com tamanho e tratamento próximos dos seletores de ordenação atuais.
- Posicionado abaixo do título “Todas as lojas”, alinhado à esquerda. A ordenação e o Inter permanecem no cabeçalho existente, com reflow quando necessário.
- O título muda para a categoria selecionada.
- O handoff e o design system do projeto governam a implementação. O HTML demonstrativo da conversa não é fonte de tokens, fontes, dados ou runtime.

## 2. Contrato visual proposto

Referências verificadas: `docs/design_handoff_farejo/README.md`, `farejô Design System.dc.html`, `apps/web/src/components/catalog-controls.tsx` e `apps/web/src/app/globals.css`.

| Elemento | Especificação para implementação |
|---|---|
| Botão | Hanken Grotesk, `text-sm`, peso e borda como a opção ativa de ordenação, `rounded-full`, `px-3.5 py-1.5`; altura natural próxima de 34 px no desktop. Medir contra o controle real, não fixar uma largura arbitrária. |
| Rótulo | “Categorias” + chevron pequeno de Lucide. Manter o rótulo curto; o nome completo selecionado aparece no título. |
| Posição | Margem superior de 12 px abaixo do título; espaço de 24 px antes da grade como ponto de partida da escala do projeto. Validar a composição a 1440 px. |
| Aberto | Superfície branca, borda neutra `#e0ddd4`, raio e sombra derivados do handoff; ancoragem à esquerda do botão, largura limitada ao catálogo. Sem escurecer a página inteira. |
| Opções | Nomes completos, ícones discretos da mesma família e seleção indicada por texto/check e tint verde; três ou quatro colunas conforme a largura e os rótulos reais. Ordem editorial estável. “Todas as lojas” remove o filtro. |
| Tipografia e cores | Hanken Grotesk na interface; Space Grotesk nos números existentes; Geist Mono apenas onde o projeto já usa labels. Fundo `#fbfaf7`, tinta `#12140f`, secundário `#5b5f56`, ação `#1c7a4d`. |
| Telas menores | Painel limitado à largura disponível, opções em uma ou duas colunas e área tocável de aproximadamente 44 px, sem alargar artificialmente o botão no desktop. Rolagem do painel somente quando a altura disponível exigir. |

O componente abre por clique, Enter ou Espaço. Escape e clique fora fecham. Ao fechar por Escape, o foco volta ao botão. Conteúdo fechado não recebe foco. Usar navegação com links e tabulação nativa, não atribuir `role=menu` sem implementar a navegação de teclado correspondente. Selecionar navega para a URL filtrada e fecha o painel; o destino `#catalogo` e o estado de resultados devem ser perceptíveis com teclado e leitor de tela.

O projeto ainda não possui um componente de popover entre seus componentes UI. A proposta é um disclosure pequeno com botão e links, usando os mecanismos nativos suportados pelos browsers alvo, sem adicionar uma biblioteca de componentes apenas para isso. A escolha do mecanismo e seu gerenciamento de foco devem ser verificados no primeiro incremento.

## 3. Comportamento proposto para v1

Categorias amplas, uma selecionada por vez. A relação loja–categoria continua muitos-para-muitos. Subcategorias, seleção combinada e página de exploração ficam para evolução posterior; isto é uma recomendação de escopo, não uma resposta presumida à pergunta anterior sobre profundidade.

| Estado | Título e comportamento |
|---|---|
| Sem categoria e sem busca | “Todas as lojas”. |
| Categoria | Nome da categoria, por exemplo “Moda e acessórios”. |
| Só busca | Preservar “Resultados para ‘termo’”. |
| Categoria e busca | Nome da categoria no título; linha de apoio “Resultados para ‘termo’” e contagem filtrada. |
| Categoria sem lojas elegíveis | Estado vazio contextual e ação para remover categoria; não chamar de anomalia global. |
| Busca sem resultado | Permitir limpar só a busca ou só a categoria, preservando o outro filtro. |
| Parâmetro inválido/desconhecido | Mensagem de filtro inválido e caminho para removê-lo. Não exibir todas as lojas sob o título de uma categoria que não foi aplicada. |

Contrato de navegação:

- URL proposta: `/?category=moda-acessorios&q=renner&sort=az&page=2#catalogo`.
- Ausência de `category` representa todas as lojas. Slugs de categorias são estáveis; rótulos podem ser revisados sem alterar URLs.
- Trocar categoria preserva `q` e `sort`, reinicia `page=1`. Trocar ordenação preserva categoria e busca, reinicia página.
- Nova busca preserva categoria e ordenação e reinicia página. Isso altera deliberadamente o comportamento atual de `HeroSearch`, que retorna a `sort=platforms`; documentar esse delta.
- Paginação, salto de página, recuperação de página fora do intervalo e voltar/avançar do navegador preservam os filtros. Sincronizar o input da busca com a URL ao navegar no histórico.
- “Todas as lojas” no dropdown remove somente categoria. Não limpar silenciosamente o texto da busca.
- Busca e categoria se combinam com E; uma loja com duas categorias aparece uma única vez no resultado da categoria escolhida.
- O hero passa a usar o total global elegível; a contagem do catálogo usa o total filtrado. A proposta evita que o número geral de lojas varie ao escolher um assunto. O arredondamento existente permanece.
- Sem contagens por opção no dropdown nesta v1: evita consultas de facetas e números que mudam enquanto o usuário navega. A contagem aparece nos resultados.
- Categorias conhecidas ficam disponíveis mesmo com zero lojas temporariamente elegíveis; o estado vazio é recuperável e não depende de esconder/reordenar opções.
- URLs com categoria recebem `noindex,follow` nesta etapa, como busca/ordenação alternativa; canonical normalizado preserva o filtro. Não criar landing pages de SEO nem adicioná-las ao sitemap agora.
- Filtro não muda as regras de frescor, percentuais versus fixos, relevância ou preferência Inter. Categoria da loja não garante cashback para todo produto daquele departamento; manter as regras e avisos atuais de ativação.

## 4. Dados e curadoria

### Situação da pesquisa

O snapshot de 10/09 contém 1.021 lojas, 963 elegíveis. Há 49 propostas reaproveitáveis do piloto, um inconclusivo, três sondagens e 968 sem pesquisa individual. Esses são números daquele snapshot, não uma contagem ao vivo. O piloto e suas associações continuam pendentes de aprovação; gostar do dropdown não equivale a aprovar seus dados.

A próxima exploração de dados deve:

1. Reconciliar o inventário com a base atual: novas lojas, merges, slugs absorvidos e mudanças de elegibilidade.
2. Fechar o conjunto de categorias amplas após pesquisar as lacunas já encontradas: brinquedos/bebês, óticas, energia/serviços e outras atividades sem encaixe claro. Não forçar rótulos apenas para obter cobertura.
3. Pesquisar os 20 lotes existentes, priorizando lojas elegíveis e com maior cobertura de plataformas, e completar as pendências dos generalistas do piloto.
4. Registrar por associação: loja canônica, categoria, fonte pública, data de consulta, evidência, confiança, status de pesquisa e decisão de curadoria. Preferir departamentos oficiais da loja; fontes de cashback são apoio quando necessário, com essa limitação registrada.
5. Distinguir cobertura parcial, inconclusivo, fora do escopo e revisado. Ausência de associação não comprova que a loja não comercializa aquela categoria. Marketplace é perfil independente, nunca inscrição automática em todas as categorias.
6. Emitir relatório por lote e revisão final com cobertura das lojas elegíveis, lacunas por categoria e pendências explícitas. Nenhuma categoria publicada pode depender apenas de inferência pelo nome da loja.

### Modelo proposto

- Manifesto de categorias e associações aprovadas versionado em `curation/`, separado dos arquivos de pesquisa e do manifesto de aliases.
- `categories`: slug único, nome, ordem de exibição, identificador de ícone permitido e estado ativo. Sem árvore hierárquica nesta v1.
- `store_categories`: FKs para loja canônica e categoria, chave única pelo par, vínculo à revisão aplicada. Índices para categoria → lojas e loja → categorias.
- Metadados de aplicação: revisão/hash, data e resultado; evidências completas continuam no material de curadoria e não entram no DTO público.
- Não persistir agora um modelo de perfil de marketplace só porque ele existe na pesquisa. Guardar essa informação no artefato de pesquisa; o filtro depende das associações confirmadas.
- Lojas sem classificação continuam em “Todas as lojas” e na busca geral. Novas lojas entram em relatório de pendências por um comando de reconciliação; não recebem rótulo automático nem bloqueiam a coleta de cashback.

Aplicação: validar schema, fontes, categorias e identidade canônica; oferecer dry-run com diff de inclusões/remoções; aplicar cada revisão como uma transação, verificando o resultado materializado; repetição da mesma revisão não altera o resultado. Falha não publica metade de um lote. Invalidação do cache deve ser repetível mesmo quando a transação já foi aplicada e a primeira notificação falhou.

Curadoria de aliases e categorias precisa coordenar identidade: antes de remover uma loja absorvida, migrar e deduplicar suas associações e manter proveniência. Manifestos antigos não podem recriar a identidade absorvida ou apagar relações por mera divergência de slug. Resolver aliases confirmados, rejeitar referências ambíguas e serializar as operações de curadoria concorrentes. A API atual de merge deve continuar aceitando seu contrato existente.

## 5. Integração técnica verificada

| Área | Mudança planejada |
|---|---|
| `apps/web/src/lib/catalog-url.ts` | Incluir categoria no contrato único de URL e preservar omissão dos defaults. |
| `apps/web/src/lib/catalog.ts` | Parse/validação, DTO mínimo de categorias, contagem global e consulta filtrada; incluir categoria na chave de cache e manter tag `catalog`. |
| `apps/web/src/app/(catalogo)/page.tsx` | Título contextual, botão abaixo do título, metadados, estados vazios e links de recuperação preservando filtros. |
| `catalog-controls.tsx`, `hero-search.tsx`, `page-jump.tsx` | Propagar categoria e ajustar navegação sem regressão de ordenação ou histórico do navegador. |
| Novo componente de categorias | Interação client-side mínima; recebe opções públicas do servidor; não consulta banco no navegador. |
| `web_read.catalog_search` | Nova assinatura explícita com categoria. Filtrar antes de relevância final, contagem, ordenação e paginação, usando `EXISTS` para não multiplicar lojas/ofertas. Manter a assinatura atual de três argumentos compatível durante a transição, sem sobrecarga ambígua por default. |
| `web_read` e permissões | Expor apenas taxonomia aprovada e relações necessárias; `farejo_web` segue lendo o contrato interno. Tabelas privadas/RLS e grants específicos; nenhum acesso para navegador, `anon` ou `authenticated`, nem `service_role` na Vercel. Preservar o modelo de owner restrito já implementado. |
| `apps/scraper/src/curation` e migrations de aliases | Validação/aplicação do novo manifesto e preservação das associações no merge. Estender o mecanismo existente sem executar enriquecimento dentro dos adapters. |
| Workflows de curadoria/deploy | Aplicação do manifesto revisado depois de schema compatível; verificação e invalidação; concorrência coordenada com aliases. A Action de aliases atual dispara apenas pelo caminho do manifesto de aliases: um novo manifesto não será aplicado automaticamente sem esse trabalho. |

Criar migrations novas, sem editar as migrations históricas. Preparar a evolução no Supabase local com os comandos suportados pela CLI instalada. Verificar documentação e permissões ao implementar. Fontes remotas serão acessadas para pesquisa; não há necessidade de credenciais privadas de lojistas.

Não adicionar categorias nos cards ou no detalhe como requisito desta primeira entrega. Isso preserva o foco no filtro escolhido; também evita inserir links dentro do `Link` que já envolve cada card. O read model de categorias permite essa evolução depois.

## 6. Entregas e dependências

| Entrega | Depende de | Resultado verificável |
|---|---|---|
| C1 — Contrato e amostra revisada | Nenhuma | Taxonomia ampla inicial, regras de evidência e pequena amostra curada de especialista/generalista; composição do botão ajustada no handoff, com estados fechado, aberto e selecionado. Não exige terminar todos os lotes. |
| C2 — Filtro completo em ambiente local | C1 | Migration compatível, dados de teste, leitura SQL, URL, dropdown, título, busca, paginação e estados funcionando de ponta a ponta; testes de dados, teclado, responsividade e imagens. Inclui preservação de categorias no merge de aliases antes de qualquer uso real. |
| C3 — Curadoria reproduzível | C2 | Dry-run, validação, aplicação atômica/idempotente, reconciliação de novas lojas e aliases, registro de revisão e invalidação recuperável. Uma revisão aprovada consegue ser aplicada e verificada de ponta a ponta no ambiente local. |
| C4 — Pesquisa de todo o inventário | C1 | Lotes completos com fontes e decisão registrada; relatório final de cobertura e pendências. Pode avançar enquanto C2/C3 são desenvolvidos. |
| C5 — Integração e liberação | C2, C3, C4 | Manifesto revisado, aplicação compatível com deploy, smoke tests, aceite visual a 1440 px e relatório de cobertura conhecido. |

As entregas são uma decomposição proposta, não issues publicadas. C2 pode usar fixtures sintéticas desde o início; o desenvolvimento do filtro não precisa esperar a pesquisa das mil lojas. A liberação do catálogo categorizado depende do tratamento explícito da cobertura real.

## 7. Testes e critérios de aceite

Priorizar as fronteiras existentes: `apps/web/test/catalog-search-db.test.ts`, testes de merge em `apps/scraper/src/curation/aliasMerge-db.test.ts`, smoke web e Playwright em `apps/web/e2e/`. Não criar uma infraestrutura de teste paralela.

- Fixture com mais de 24 lojas na categoria; provar que a filtragem precede paginação e que a contagem não considera apenas a página visível.
- Generalista em Moda e Casa, especialista em Moda, loja sem categoria e loja classificada sem oferta elegível. Sem duplicação, sem perda na busca geral e sem oferta vencida no resultado.
- Nome e alias pesquisados com categoria; relevância, empates, percentuais/fixos e ordenação Inter preservados.
- URLs compartilhadas, parâmetros repetidos/inválidos/desconhecidos, categoria vazia, página fora do intervalo, limpar filtros separadamente, voltar/avançar e input sincronizado.
- Manifesto com associação sem evidência, categoria inexistente, slug absorvido, identidade ambígua, associação duplicada; rollback em erro, idempotência, remoção intencional e nova tentativa de invalidação após falha.
- Merge de aliases preserva categorias e as inscrições já suportadas; corrida entre operações não perde vínculos.
- Role web lê apenas a projeção permitida; roles públicas não ganham acesso às novas tabelas/funções.
- Dropdown abre e fecha por teclado, conteúdo oculto fora da tabulação, foco correto, seleção perceptível e rótulos longos legíveis. Axe nos estados aberto e fechado.
- Regressão visual a 1440 px com fontes reais, botão medido junto da ordenação; reflow a 1024, 768, 390 e 320 px. Sem mudança lateral da grade desktop de três colunas nem overflow horizontal.
- Gate de implementação: typecheck, testes Vitest relevantes, smoke web, build e testes Playwright afetados; CI completa conforme o workflow do projeto. Nesta etapa documental esses testes não foram executados.

## 8. Liberação, recuperação e próxima exploração

Implantar schema aditivo e permissões primeiro; verificar o contrato antigo ainda funcionando; aplicar o manifesto revisado; invalidar/verificar cache; liberar o frontend que usa categorias. Previews e testes usam banco local/fixtures, conforme o contrato vigente.

Antes da liberação: reconciliar novamente o inventário e registrar situação de todas as lojas elegíveis. Meta proposta: todas revisadas, com cada inconclusivo explicitado; não exigir classificação inventada para chegar a 100% de associações. Pendências em lojas generalistas ou categorias centrais precisam de resolução ou decisão de escopo documentada.

Recuperação: frontend anterior permanece compatível com o schema aditivo; revisão anterior do manifesto pode ser reaplicada como nova revisão, com diff e invalidação. Não remover tabelas em rollback urgente. Falha de dados ou consulta recebe estado explícito; não apresentar resultado amplo como se estivesse filtrado.

**Próxima exploração recomendada:** C1, começando pelas lacunas da taxonomia e pela revisão de uma amostra pequena que exercite os casos de generalista e especialista. Já há informação suficiente para planejar C2; o risco ainda aberto é a consistência/cobertura da classificação. Não é necessária outra rodada de referências visuais para escolher o formato.
