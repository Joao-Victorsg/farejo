# Referências de navegação por categorias

**Escolha posterior de João:** seguir com dropdown integrado ao catálogo, botão compacto semelhante à ordenação e posicionado abaixo do título. Ver [plano de implementação](plano-implementacao.md). A alternativa de página de exploração permanece apenas como referência.

Data: 10/09/2026. Pesquisa de interfaces públicas, com inspeção visual no navegador e abertura dos controles. Direções para discussão, sem implementação ou decisão de produto aprovada.

## Revisão da proposta anterior

João não gostou da apresentação do protótipo com atalhos em pílulas e pediu referências reais. A apresentação anterior fica em revisão. A classificação de uma loja em várias categorias continua independente do componente visual usado para escolher uma categoria.

Minha leitura do protótipo: muitos elementos arredondados de peso semelhante disputam atenção com a ordenação e a preferência Inter. Trocar apenas os ícones não resolve a hierarquia. Esta é uma avaliação de design, não um resultado de teste com usuários.

## Interfaces observadas

| Referência | Observação visual e interação | Aplicação possível ao farejô |
|---|---|---|
| [Quidco — Browse](https://www.quidco.com/browse/) | Botão Categories na navegação abre um painel amplo de links em quatro colunas, sem ícones por categoria. O restante da página fica escurecido. Há também uma página com seções por categoria, lojas e link para ver todas daquela categoria. | Melhor referência para organizar muitas opções sem ocupar permanentemente a área do catálogo. A ausência de ícones não impede a leitura. |
| [Cuponomia — Categorias](https://www.cuponomia.com.br/cupom) | Página própria; Top 20 Categorias em grade de quatro colunas, cada bloco horizontal com ícone monocromático à esquerda e nome. Abaixo há lojas populares e índice alfabético de categorias. | Boa referência para exploração visual e para propor uma futura página Categorias. Copiar os vinte blocos acima da grade da home empurraria as lojas para baixo. |
| [TopCashback — menu Categories](https://www.topcashback.com/) | Menu amplo com lista vertical à esquerda e marcas em destaque à direita. Clicar Fashion troca a lista por All Fashion, Shoes, Women's Apparel e outras subcategorias, com Back. O menu foi inspecionado na página pública /navigation/, que é uma página da loja Navigation.com, não um diretório de navegação. | A interação pai → filhos serve para uma taxonomia mais profunda. O espaço promocional de marcas e a complexidade de subníveis não são necessários na primeira versão do farejô. |
| [Méliuz — seção Categorias](https://www.meliuz.com.br/cupom) | A página tem uma barra textual de atalhos no topo. Mais abaixo, a seção Categorias usa quatro colunas, ícones de contorno, nomes e setas. Moda e Acessórios expande links como Tudo em Moda, Calçados, Roupas e Relógios. | Boa referência para representação leve: ícone como apoio, texto como elemento principal e seta apenas quando existem filhos. Evitar deixar o único acesso às categorias tão abaixo no catálogo. |

As observações acima descrevem as telas desktop renderizadas nesta sessão. Não são recomendações para copiar as taxonomias ou taxas de cashback dessas plataformas.

## Duas direções para comparar

### A. Seletor de categorias integrado ao catálogo — preferida

- Controle visível “Categorias” junto ao início do catálogo, com nome da categoria selecionada.
- Ao abrir, painel com opções alinhadas em colunas, inspirado no Quidco; ícones pequenos de contorno e texto inspirado no Méliuz.
- Sem uma sequência permanente de dezesseis ou mais pílulas. Sem coluna lateral fixa consumindo a largura da grade atual de três colunas.
- “Todas as lojas” como ação explícita para remover o filtro; seleção fica visível depois de fechar o painel.
- Selecionar uma categoria filtra lojas e mantém busca/ordenação conforme contrato a definir. Store multicategoria continua aparecendo em cada categoria pesquisada e confirmada.
- No mobile, proponho um botão que abre lista vertical em painel sobreposto com título e fechar. É uma proposta para protótipo, não comportamento mobile confirmado nos sites pesquisados. Comparar com uma lista em fluxo antes de fechar a decisão.

Vantagem esperada: ocupa pouco espaço e encaixa na estrutura atual. Custo: exige abrir o painel para conhecer todas as opções.

### B. Página de exploração por categorias

- Acesso “Categorias” na navegação leva a uma página própria.
- Blocos de tamanho consistente, ícone e nome, como o Cuponomia, com menos peso visual que os cards de cashback.
- Selecionar um bloco leva ao catálogo filtrado. Dentro do catálogo permanece um seletor compacto para trocar de assunto.

Vantagem esperada: categorias ganham identidade e espaço para descoberta. Custo: acrescenta uma página e uma etapa para quem quer comparar rapidamente. Não é necessário criar fotografias ou ilustrações exclusivas para cada assunto.

## Ícones e hierarquia

Ícones são opcionais no seletor e úteis na página de exploração. Usar uma única família de contorno, tamanho e alinhamento consistentes, com rótulo sempre visível. Evitar emojis e cores diferentes para cada categoria como solução de hierarquia. O projeto já possui lucide-react; não há necessidade identificada de adquirir ou gerar um pacote de imagens.

Não criar subcategorias apenas para justificar um menu hierárquico. Primeiro validar a cobertura do catálogo e a nomenclatura. O menu deve acomodar categorias longas sem truncamento enganoso. Marketplace continua sendo perfil da loja, não substituto das categorias de produtos.

## Limitações da pesquisa

- ShopBack US retornou “Region not available”; não foi usado como referência visual.
- A tentativa de viewport 390 × 844 não alterou as capturas, que continuaram em desktop. O override foi removido. Portanto, o comportamento mobile dessas referências não foi validado nesta sessão.
- Não houve teste de usabilidade, medição de conversão ou auditoria completa de acessibilidade. Benefícios e custos acima são inferências para orientar os próximos protótipos.
- Esta pesquisa de interface não conclui a classificação individual das 1.021 lojas. O inventário e a fila de pesquisa continuam com o estado registrado no README.

## Próxima comparação visual sugerida

Comparar A e B sobre a mesma home real, com busca, ordenação, toggle Inter e cards completos. Avaliar largura de 1440 px e tela estreita; estados fechado, aberto e categoria selecionada. Assim a decisão considera a composição inteira, em vez de uma faixa isolada de categorias.
