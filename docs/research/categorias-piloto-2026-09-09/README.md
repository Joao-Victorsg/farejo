# Piloto de categorias — 50 lojas do farejô

**Status: propostas para revisão. Nenhuma classificação foi aplicada ao produto.**

Pesquisa inicial realizada em **09/09/2026, horário de São Paulo** (10/09/2026 UTC). Leitura do inventário iniciada às 23h16 BRT. Código local: `443bced`; a comparação com a master remota mostrou apenas alterações posteriores de curadoria.

**Revisão em 10/09/2026:** os cinco generalistas recebem categorias comerciais com evidência. O perfil de marketplace fica separado. O snapshot e suas contagens não foram atualizados.

## Resultado

- **50 registros**, todos elegíveis no snapshot original; **49 com propostas e 1 inconclusivo**: testeops.
- **13 lojas com múltiplas categorias**, de 2 a 11; **99 associações propostas**.
- **16 categorias de produtos/serviços**; marketplace saiu da taxonomia de categorias e passou ao perfil da loja.
- **74 referências**: 56 originais e 18 acrescentadas nesta revisão.
- **9 registros com atenção** (incluindo o inconclusivo); todas as associações continuam pendentes.
- Inventário original: **1.019 lojas**, **963 elegíveis**; amostra com **11 lojas em uma plataforma e 39 em duas ou mais**.

49/50 mede classificabilidade, não acurácia. A amostra é intencional e não houve avaliação humana independente. As categorias das outras 45 lojas foram preservadas; seus perfis comerciais estão explicitamente não avaliados.

## Arquivos

- [Dados estruturados: taxonomia, propostas e fontes](dados.json).
- [Snapshot das 50 lojas, aliases e links das plataformas](catalogo-amostra.json).
- [Consultas de leitura para reproduzir o levantamento](consultas.sql).

Não foram lidos dados de assinantes ou mensagens, nem alterados registros no banco. O snapshot contém somente identificação das lojas, aliases e links de páginas públicas.

## Como o levantamento foi feito

1. Leitura de `stores` com a elegibilidade e a contagem de plataformas da view pública.
2. Escolha intencional de 50 registros para variar tipo de produto/serviço, presença em plataformas, clareza do nome e possibilidade de múltiplas categorias.
3. Consulta aos aliases para reduzir ambiguidades. A escolha manual favorece alguns nomes reconhecíveis; não pretende representar a distribuição das 963 lojas elegíveis.
4. Pesquisa por páginas da própria empresa, sua controladora e páginas vinculadas das plataformas de cashback. Foram consultados departamentos, descrições comerciais e páginas institucionais.
5. Formulação da taxonomia abaixo e mapeamento das evidências para categorias permitidas. As propostas são inferências editoriais do pesquisador assistido por IA, não declarações oficiais das lojas.
6. Registro de ressalvas quando a identidade, a abrangência regional, a modalidade de acesso ou uma fronteira editorial exigem revisão.

**Limites de acesso:** muitos resultados foram examinados pela indexação da ferramenta de busca, e não por uma visita direta à página. A data desta pesquisa não é a data de rastreamento de cada fonte. Algumas fontes indexadas são antigas; no caso da Brinox, a limitação está destacada. A home da Growth mostrou verificação de navegador, e sua vitrine no Mercado Livre bloqueou abertura direta; não houve tentativa de contornar o bloqueio. URLs semelhantes que apenas alegavam ser a loja oficial e um resultado de ambiente de staging não foram usados como fonte final.

## Critérios propostos

- **Unidade: loja canônica.** Sem novos merges de aliases.
- **Categorias indicam o que se compra; perfil indica como a loja opera.** Generalista/especializado e operar marketplace são eixos independentes. Um marketplace pode ser especializado.
- **Múltiplas categorias sem limite artificial.** Departamento estruturado com variedade ou linha comercial relevante sustenta associação, mesmo sem ser o segmento dominante. A regra vale para toda loja.
- **Sem atribuição automática de todas as categorias.** Anúncio isolado, item patrocinado fora do segmento, marca do mesmo grupo ou alegação de vender tudo não bastam. Ausência de associação significa pesquisa parcial, não ausência de venda.
- **Fonte por associação.** Preferir departamento oficial. Descrição da plataforma de cashback pode sustentar proposta com ressalva, como no AliExpress. Cada associação tem aprovação própria e começa pendente.
- **Classificar o produto ou serviço real.** Celulares não são planos de telefonia; malas não comprovam turismo; livros não comprovam cursos; periféricos gamer não comprovam jogos.
- **E-commerce é canal.** Não é categoria de produto. Marketplace também não substitui Moda, Alimentos ou qualquer segmento comprovado.
- **Categoria não comprova cobertura de cashback.** Canal, vendedor, região e condições de ativação continuam precisando de verificação própria.
- **Inconclusivo continua em Todas.** Nenhuma categoria inventada para preencher lacunas.
- **Perfil não avaliado não significa especialista.** As 45 lojas fora desta revisão usam operates_marketplace=null; não podem ser filtradas como se esse valor fosse false.
- **Proposta de navegação:** incluir marketplaces nas categorias sustentadas. Um filtro opcional por perfil pode ser avaliado após completar essa curadoria. A ordenação aprovada do catálogo permanece como referência.
- **Todas as propostas seguem pendentes.** Esta revisão não publica categorias nem implementa filtros.

## Taxonomia candidata

Estas 16 categorias são provisórias. A remoção de Marketplaces separa o perfil das categorias. Casa explicita eletrodomésticos; Entretenimento explicita jogos físicos e consoles. Bebês/brinquedos, papelaria e outros segmentos ainda precisam de avaliação em lote próprio.

| Categoria | Incluir quando | Limite e exclusões |
|---|---|---|
| Alimentos e bebidas (alimentos-bebidas) | Comida, bebidas, mercearia, cafés, vinhos e supermercados como atividade relevante. | Ração pertence a Pets; suplementos esportivos concentrados ficam em Saúde/Esportes. Ter snacks de conveniência não basta. |
| Moda e acessórios (moda-acessorios) | Roupas, calçados, bolsas, joias e acessórios para vestir. | Roupas para animais ficam em Pets. Roupas esportivas podem acumular Esportes. |
| Beleza e cuidados pessoais (beleza-cuidados) | Cosméticos, perfumes, maquiagem, produtos capilares e higiene pessoal como linhas relevantes. | Não inferir Saúde a partir de qualquer cosmético. Produtos pet ficam em Pets. |
| Saúde e bem-estar (saude-bem-estar) | Farmácias, equipamentos para saúde humana e suplementos como atividade relevante. | Classificação comercial, sem afirmação de eficácia ou recomendação de uso. Cosméticos comuns não entram automaticamente. |
| Eletrônicos e informática (eletronicos-informatica) | Computadores, componentes, periféricos e eletrônicos físicos. | Serviços de software, cursos de tecnologia e planos de dados têm categorias próprias. Gamer não implica venda de jogos. Eletrodomésticos ficam em Casa; consoles e jogos em Entretenimento. |
| Casa e jardim (casa-jardim) | Móveis, decoração, utensílios domésticos, eletrodomésticos, eletroportáteis para o lar, construção, jardinagem e serviços para cuidar do lar. | Inclui material de obra e limpeza residencial no piloto. Avaliar separar Construção e Serviços se a revisão indicar dificuldade de navegação. |
| Esportes e fitness (esportes-fitness) | Equipamentos, vestuário esportivo e nutrição explicitamente destinada à prática esportiva. | Transmissões esportivas ficam em Entretenimento; alimentos saudáveis comuns não entram apenas por marketing. |
| Pets (pets) | Produtos, alimentação, acessórios e serviços para animais de companhia. | Ração não entra em Alimentos e remédios veterinários não entram em Saúde humana. |
| Viagens e turismo (viagens-turismo) | Hospedagem, passagens e serviços explicitamente destinados à viagem, como seguro viagem e eSIM de viagem. | Não classificar todo serviço usado por um viajante como Viagens. A relação precisa ser central na oferta. Malas e bagagens, por si, não comprovam venda de serviços turísticos. |
| Livros e educação (livros-educacao) | Venda de livros, clubes de leitura e cursos, inclusive departamentos de livros em generalistas. | O assunto do livro/curso não atribui categorias extras: curso de programação não vira loja de eletrônicos. |
| Software e serviços digitais (software-digital) | Software de produtividade, segurança digital, hospedagem e infraestrutura web. | Planos de conectividade ficam em Telefonia. Jogos e streaming ficam em Entretenimento. Ser online não basta. |
| Entretenimento e games (entretenimento-games) | Jogos físicos e digitais, consoles e acessórios dedicados, assinaturas de streaming e conteúdo de entretenimento. | Computadores e periféricos de uso geral, mesmo gamer, ficam em Eletrônicos; cadeiras em Casa. Esportes transmitidos não viram artigos esportivos. |
| Automotivo (automotivo) | Pneus, peças e serviços diretamente ligados ao uso ou manutenção de veículos, incluindo tags de pedágio. | Passagens de ônibus e reservas de viagem ficam em Viagens. |
| Presentes e flores (presentes-flores) | Floriculturas e negócios especializados em arranjos, cestas e presentes por ocasião. | Não classificar toda loja que vende gift card ou permite presentear. Chocolates acessórios a um arranjo não exigem Alimentos. |
| Finanças e seguros (financas-seguros) | Serviços financeiros, remessas internacionais e seguros. | Venda de cartão próprio de um varejista não basta. Guardar dados financeiros em software não torna a loja financeira. |
| Telefonia e internet (telefonia-internet) | Planos móveis, banda larga e pacotes eSIM/dados. | Aparelhos físicos são Eletrônicos; hospedagem é Software. eSIM voltado a viagem pode acumular Viagens. |

## As 50 lojas

Propostas editoriais pendentes de aprovação. As contagens de plataformas pertencem ao snapshot original. Perfil generalista + marketplace foi avaliado apenas nas cinco primeiras linhas; os demais perfis estão não avaliados. Cada categoria tem suas fontes específicas em dados.json.

| # | Loja | Plataformas elegíveis | Categorias propostas | Evidência resumida e interpretação | Situação | Fontes |
|---|---|---:|---|---|---|---|
| 1 | **Mercado Livre** (mercadolivre) | 2 | Alimentos e bebidas; Moda e acessórios; Beleza e cuidados pessoais; Saúde e bem-estar; Eletrônicos e informática; Casa e jardim; Esportes e fitness; Pets; Livros e educação; Entretenimento e games; Automotivo | Departamentos comerciais sustentam múltiplas categorias; a operação generalista passa a ser um perfil separado. | Proposta | [F57](https://www.mercadolivre.com.br/categorias) · [F58](https://lista.mercadolivre.com.br/categorias) |
| 2 | **Magazine Luiza** (magazineluiza) | 4 | Alimentos e bebidas; Moda e acessórios; Beleza e cuidados pessoais; Saúde e bem-estar; Eletrônicos e informática; Casa e jardim; Esportes e fitness; Pets; Livros e educação; Entretenimento e games; Automotivo | Navegação geral e departamentos específicos sustentam as associações; produtos patrocinados fora do segmento não geram categorias. | Proposta | [F59](https://especiais.magazineluiza.com.br/compre-agora/) · [F64](https://www.magazineluiza.com.br/mercado/l/me/) · [F61](https://www.magazineluiza.com.br/beleza-e-perfumaria/l/pf/) · [F66](https://www.magazineluiza.com.br/saude-e-cuidados-pessoais/l/cp/) · [F62](https://www.magazineluiza.com.br/esporte-e-lazer/l/es/) · [F65](https://www.magazineluiza.com.br/pet-shop/l/pe/) · [F63](https://www.magazineluiza.com.br/livros/l/li/) · [F67](https://www.magazineluiza.com.br/games/l/ga/) · [F60](https://www.magazineluiza.com.br/categorias/) |
| 3 | **AliExpress** (aliexpress) | 4 | Moda e acessórios; Beleza e cuidados pessoais; Eletrônicos e informática; Casa e jardim; Automotivo | Descrições das plataformas de cashback sustentam cinco categorias como propostas com ressalva; confirmação direta dos departamentos ficou pendente. | Revisar ressalvas | [F03](https://www.alibabagroup.com/en-US/about-alibaba-businesses-1747705938191581184) · [F69](https://www.meliuz.com.br/desconto/cupom-aliexpress) · [F70](https://www.cuponomia.com.br/desconto/aliexpress) |
| 4 | **Shopee** (shopee) | 3 | Alimentos e bebidas; Moda e acessórios; Beleza e cuidados pessoais; Saúde e bem-estar; Eletrônicos e informática; Casa e jardim; Esportes e fitness; Pets; Livros e educação; Entretenimento e games; Automotivo | Diretório brasileiro sustenta onze categorias de compra, incluindo moda e calçados; marketplace permanece como perfil. | Proposta | [F04](https://cdn.sea.com/webmain/static/resource/seagroup/pressrelease/2024AR/NT8CQURDcqzIyTpTQ0SN/2025-04-17%20-%20Form%2020-F.pdf) · [F68](https://shopee.com.br/l/category/home) |
| 5 | **Carrefour** (carrefour) | 4 | Alimentos e bebidas; Moda e acessórios; Beleza e cuidados pessoais; Eletrônicos e informática; Casa e jardim; Esportes e fitness; Pets; Entretenimento e games; Automotivo | Supermercado e shopping sustentam nove categorias. Alimentos segue a mesma regra de evidência dos demais segmentos; deixa de ser exceção. | Revisar ressalvas | [F71](https://mercado.carrefour.com.br/categoria/) · [F74](https://grupocarrefourbrasil.com.br/news/carrefour-e-powerade-parceiros-dos-jogos-olimpicos-paris-2024-criam-experiencia-imersiva-para-os-consumidores) · [F73](https://www.carrefour.com.br/s/olympikus%20olympikus?map=ft) · [F72](https://www.carrefour.com.br/) |
| 6 | **Swift** (swift) | 1 | Alimentos e bebidas | O catálogo apresenta carnes, pescados, hortifruti, refeições prontas, mercearia e bebidas. | Proposta | [F07](https://www.swift.com.br/) |
| 7 | **Baggio Café** (baggiocafe) | 4 | Alimentos e bebidas | A marca vende cafés em diferentes apresentações e assinaturas de café; acessórios não alteram o segmento principal. | Proposta | [F08](https://baggiocafe.com.br/) |
| 8 | **Casas Pedro** (casaspedro) | 3 | Alimentos e bebidas | A página oficial apresenta um catálogo de ervas e chás para consumo, suficiente para a categoria alimentar. | Proposta | [F09](https://www.casaspedro.com.br/produtos/ervas-e-chas/casas-pedro) |
| 9 | **Evino** (evino) | 5 | Alimentos e bebidas | A loja tem catálogo de vinhos e kits de bebidas; taças e acessórios são complementares. | Proposta | [F10](https://www.evino.com.br/vinhos) |
| 10 | **Tia Sônia** (tiasonia) | 1 | Alimentos e bebidas | A navegação e os produtos destacam granolas, snacks, barras e cookies. Isso não implica uma classificação médica. | Proposta | [F11](https://www.tiasonia.com.br/) |
| 11 | **adidas** (adidas) | 5 | Moda e acessórios; Esportes e fitness | A página reúne calçados, roupas e acessórios associados a modalidades esportivas e lifestyle. | Proposta | [F12](https://www.adidas.com.br/calcados-esportes_de_areia) |
| 12 | **Renner** (renner) | 5 | Moda e acessórios | A descrição relaciona bolsas, cintos e bijuterias a roupas femininas e composições de vestuário. | Proposta | [F13](https://www.lojasrenner.com.br/c/feminino/acessorios/-/N-10ip4lqZwxqas2Z1hwylc0Z13df56z/) |
| 13 | **24S** (24s) | 1 | Moda e acessórios; Beleza e cuidados pessoais | O catálogo apresenta roupas, bolsas, joias e perfumes; a controladora confirma a curadoria de marcas de moda e beleza. | Revisar ressalvas | [F14](https://www.24s.com/en-us/women) · [F15](https://www.lvmh.com/en/our-maisons/selective-retailing/24s) |
| 14 | **Lola Cosmetics** (lolacosmetics) | 2 | Beleza e cuidados pessoais | A navegação é centrada em produtos e rotinas capilares, com shampoos, finalizadores e tratamentos. | Proposta | [F16](https://www.lolacosmetics.com.br/) |
| 15 | **Natura** (natura) | 5 | Beleza e cuidados pessoais | Perfumaria, corpo e banho, cabelos, maquiagem e rosto são linhas centrais da loja. | Proposta | [F17](https://www.natura.com.br/) |
| 16 | **Pague Menos** (paguemenos) | 5 | Saúde e bem-estar; Beleza e cuidados pessoais | A loja oferece departamentos explícitos de medicamentos/saúde e dermocosméticos/beleza. | Proposta | [F18](https://www.paguemenos.com.br/) |
| 17 | **CPAPS** (cpaps) | 1 | Saúde e bem-estar | O site da própria loja descreve a venda de equipamentos CPAP e acessórios para terapia respiratória. | Proposta | [F19](https://www.cpaps.com.br/glossario/termo/CPAP) |
| 18 | **KaBuM!** (kabum) | 5 | Eletrônicos e informática | A navegação destaca hardware, computadores, memória, periféricos e TVs. | Proposta | [F20](https://www.kabum.com.br/) |
| 19 | **Dell** (dell) | 3 | Eletrônicos e informática | A loja oficial apresenta notebooks, computadores, monitores, acessórios e servidores. | Proposta | [F21](https://www.dell.com/pt-br) |
| 20 | **Pichau** (pichau) | 1 | Eletrônicos e informática | O catálogo de hardware reúne componentes para montagem e atualização de computadores. | Proposta | [F22](https://www.pichau.com.br/hardware?rgpu=742) |
| 21 | **4seating.com** (4seating) | 1 | Casa e jardim | A loja vende poltronas, sofás e mobiliário para salas de cinema domésticas; o produto principal é mobiliário. | Revisar ressalvas | [F23](https://4seating.com/) |
| 22 | **Madesa** (madesa) | 4 | Casa e jardim | A página de cozinhas apresenta móveis e projetos para esse ambiente. | Proposta | [F24](https://www.madesa.com/pages/cozinhas) |
| 23 | **Leroy Merlin** (leroymerlin) | 4 | Casa e jardim | Há oferta explícita de materiais de construção, além de um departamento de decoração. | Proposta | [F25](https://www.leroymerlin.com.br/materiais-de-construcao/) · [F26](https://www.leroymerlin.com.br/decoracao) |
| 24 | **Brinox Shop** (brinoxshop) | 5 | Casa e jardim | O site da marca apresenta panelas, cozinha, mesa e taças; a página vinculada do Méliuz confirma utensílios de cozinha. | Revisar ressalvas | [F27](https://www.brinox.com.br/panelas/Inox/1295) · [F28](https://www.meliuz.com.br/desconto/cupom-brinox) |
| 25 | **Decathlon** (decathlon) | 5 | Esportes e fitness; Moda e acessórios | A loja estrutura o catálogo por esportes e também por roupas, calçados e acessórios esportivos. | Proposta | [F29](https://www.decathlon.com.br/) |
| 26 | **Growth Supplements** (growthsupplements) | 1 | Saúde e bem-estar; Esportes e fitness | A página vinculada no Cuponomia descreve suplementos e vitaminas para o segmento fitness. | Revisar ressalvas | [F30](https://www.cuponomia.com.br/desconto/gsuplementos) · [F31](https://www.mercadolivre.com.br/loja/growth-supplements) |
| 27 | **Cobasi** (cobasi) | 5 | Pets; Casa e jardim | A rede apresenta produtos e serviços pet e mantém um departamento próprio de jardinagem. | Revisar ressalvas | [F32](https://www.cobasi.com.br/lojas/cobasi-cantareira-norte) · [F33](https://www.cobasi.com.br/c/jardim) |
| 28 | **Pet Love** (petlove) | 2 | Pets | A oferta reúne rações, acessórios, higiene e serviços voltados a animais de companhia. | Proposta | [F34](https://www.petlove.com.br/) |
| 29 | **ZeeDog** (zeedog) | 4 | Pets | Guias, coleiras, peitorais e acessórios para cães e gatos organizam o catálogo. | Proposta | [F35](https://www.zeedog.com.br/) |
| 30 | **Booking.com** (booking) | 4 | Viagens e turismo | A página permite pesquisar e reservar hospedagens, como hotéis, casas e apartamentos. | Proposta | [F36](https://m.booking.com/index.pt-br.html) |
| 31 | **Buser** (buser) | 5 | Viagens e turismo | O serviço permite buscar e comprar viagens de ônibus por origem, destino e datas. | Proposta | [F37](https://www.buser.com.br/) |
| 32 | **Airalo** (airalo) | 3 | Telefonia e internet; Viagens e turismo | A página comercializa pacotes eSIM de dados e os apresenta como conectividade para quem viaja. | Proposta | [F38](https://www.airalo.com/pt-BR/brazil-esim/) |
| 33 | **Allianz Travel** (allianztravel) | 4 | Finanças e seguros; Viagens e turismo | A oferta principal é seguro viagem, com cotação para viagens nacionais e internacionais. | Proposta | [F39](https://www.allianztravel.com.br/) |
| 34 | **Alura** (alura) | 4 | Livros e educação | A página oferece formações e cursos para desenvolvimento de competências em tecnologia e negócios. | Proposta | [F40](https://www.alura.com.br/formacoes) |
| 35 | **Udemy** (udemy) | 3 | Livros e educação | A página descreve uma plataforma de ensino e aprendizagem, com cursos online gratuitos e pagos. | Proposta | [F41](https://www.udemy.com/pt/courses/free/) |
| 36 | **Leiturinha** (leiturinha) | 2 | Livros e educação | O serviço entrega livros infantis selecionados por idade em uma assinatura recorrente. | Proposta | [F42](https://leiturinha.com.br/) |
| 37 | **Livraria Martins Fontes Paulista** (livrariamartinsfontespaulista) | 1 | Livros e educação | O catálogo comercializa livros, dicionários e gramáticas. | Proposta | [F43](https://www.martinsfontespaulista.com.br/livros/dicionarios-e-gramaticas/dicionarios-tematicos) |
| 38 | **Hostinger** (hostinger) | 5 | Software e serviços digitais | O serviço vende hospedagem, criação e infraestrutura para sites. | Proposta | [F44](https://www.hostinger.com/br/hospedagem-de-sites) |
| 39 | **1Password** (1password) | 1 | Software e serviços digitais | O produto é um gerenciador de senhas para uso individual e familiar. | Proposta | [F45](https://1password.com/pt/product/password-manager) |
| 40 | **Notta AI** (nottaai) | 1 | Software e serviços digitais | O produto oferece transcrição, resumo e organização de reuniões com recursos de IA. | Proposta | [F46](https://www.notta.ai/pt) |
| 41 | **Disney+** (disneyplus) | 3 | Entretenimento e games | A oferta consiste em assinatura para assistir a filmes, séries e transmissões esportivas. | Proposta | [F47](https://www.disneyplus.com/pt-br) |
| 42 | **Nuuvem** (nuuvem) | 4 | Entretenimento e games | O catálogo comercializa jogos digitais, com filtros por plataformas e sistemas. | Proposta | [F48](https://www.nuuvem.com/br-pt/catalog/types/games.html) |
| 43 | **Pneu Store** (pneustore) | 3 | Automotivo | O catálogo é centrado em pneus e acessórios para veículos. | Proposta | [F49](https://www.pneustore.com.br/) |
| 44 | **Sem Parar** (semparar) | 4 | Automotivo | A tag é apresentada para pedágios, estacionamentos e outros usos ligados ao deslocamento de carro. | Proposta | [F50](https://www.semparar.com.br/onde-usar) |
| 45 | **Giuliana Flores** (giulianaflores) | 5 | Presentes e flores | O catálogo é organizado por flores, arranjos, presentes e ocasiões. | Proposta | [F51](https://www.giulianaflores.com.br/todos-os-produtos/gtodosprod/) |
| 46 | **Parafuzo** (parafuzo) | 2 | Casa e jardim | O serviço oferece faxina, passadoria, montagem de móveis e assistência residencial. | Revisar ressalvas | [F52](https://parafuzo.com/) |
| 47 | **Remessa Online** (remessaonline) | 3 | Finanças e seguros | O serviço permite enviar e receber transferências internacionais. | Proposta | [F53](https://ajuda.remessaonline.com.br/para-quais-paises-a-remessa-online-envia) |
| 48 | **Tim Controle** (timcontrole) | 2 | Telefonia e internet | A página oferece planos de telefonia móvel com franquias de internet e chamadas. | Proposta | [F54](https://www.tim.com.br/sp-interior/para-voce/planos/controle) |
| 49 | **B.O.B. Bars Over Bottles** (bobbarsoverbottles) | 2 | Beleza e cuidados pessoais | O catálogo apresenta shampoo, condicionador e outros cosméticos sólidos. O nome Bars Over Bottles não significa bebidas. | Proposta | [F55](https://www.usebob.com.br/collections/condicionador-em-barra/cabelo-ressecado) |
| 50 | **teste ops** (testeops) | 1 | — | A página do Méliuz confirma a presença do cadastro, mas usa texto genérico de cupons e não identifica o tipo de negócio. | Inconclusiva | [F56](https://www.meliuz.com.br/desconto/teste-ops) |

## Casos que merecem revisão primeiro

### AliExpress

Proposta: Moda e acessórios; Beleza e cuidados pessoais; Eletrônicos e informática; Casa e jardim; Automotivo.

- Catálogo oficial não acessível nesta sessão. Moda e Eletrônicos têm corroboração em duas plataformas; Casa, Beleza e Automotivo usam a descrição do Méliuz. Confirmar departamentos e disponibilidade para o Brasil antes de publicar.

Evidências: [F03](https://www.alibabagroup.com/en-US/about-alibaba-businesses-1747705938191581184) · [F69](https://www.meliuz.com.br/desconto/cupom-aliexpress) · [F70](https://www.cuponomia.com.br/desconto/aliexpress).

### Carrefour

Proposta: Alimentos e bebidas; Moda e acessórios; Beleza e cuidados pessoais; Eletrônicos e informática; Casa e jardim; Esportes e fitness; Pets; Entretenimento e games; Automotivo.

- Confirmar correspondência entre os canais Mercado/Shopping e os destinos das plataformas. As categorias da identidade canônica não confirmam cashback em cada operação. Parte das fontes possui rastreamento de 1 a 4 meses.

Evidências: [F71](https://mercado.carrefour.com.br/categoria/) · [F74](https://grupocarrefourbrasil.com.br/news/carrefour-e-powerade-parceiros-dos-jogos-olimpicos-paris-2024-criam-experiencia-imersiva-para-os-consumidores) · [F73](https://www.carrefour.com.br/s/olympikus%20olympikus?map=ft) · [F72](https://www.carrefour.com.br/).

### 24S

Proposta: Moda e acessórios; Beleza e cuidados pessoais.

- As páginas de moda consultadas usam a vitrine dos EUA. Confirmar a pertinência de Beleza para a experiência de compra brasileira antes de publicar essa associação.

Evidências: [F14](https://www.24s.com/en-us/women) · [F15](https://www.lvmh.com/en/our-maisons/selective-retailing/24s).

### 4seating.com

Proposta: Casa e jardim.

- Categoria de móveis sustentada; entrega e viabilidade de compra no Brasil não foram verificadas.

Evidências: [F23](https://4seating.com/).

### Brinox Shop

Proposta: Casa e jardim.

- O conteúdo legível do site oficial veio do índice de busca, com rastreamento antigo. A página atual do Méliuz corrobora utensílios; a home oficial abriu sem catálogo legível.

Evidências: [F27](https://www.brinox.com.br/panelas/Inox/1295) · [F28](https://www.meliuz.com.br/desconto/cupom-brinox).

### Growth Supplements

Proposta: Saúde e bem-estar; Esportes e fitness.

- A home oficial apresentou verificação de navegador; a classificação usa a página da plataforma e a vitrine oficial no marketplace indexada.
- No Cuponomia, a regra distingue compras no Mercado Livre das compras no site da Growth. Categoria não equivale a cashback válido em todo canal.
- Revisar a regra editorial de suplementos em Saúde e Esportes; não classificar automaticamente como Alimentos.

Evidências: [F30](https://www.cuponomia.com.br/desconto/gsuplementos) · [F31](https://www.mercadolivre.com.br/loja/growth-supplements).

### Cobasi

Proposta: Pets; Casa e jardim.

- Confirmar se o departamento recorrente de jardinagem justifica a segunda categoria em um negócio principalmente pet.

Evidências: [F32](https://www.cobasi.com.br/lojas/cobasi-cantareira-norte) · [F33](https://www.cobasi.com.br/c/jardim).

### Parafuzo

Proposta: Casa e jardim.

- Confirmar se Casa e jardim deve incluir serviços domésticos ou se a navegação precisa de uma categoria Serviços.

Evidências: [F52](https://parafuzo.com/).

### teste ops

Proposta: manter sem categoria.

- Identidade comercial inconclusiva. Investigar em escopo separado; o piloto não remove nem reclassifica a oferta automaticamente.

Evidências: [F56](https://www.meliuz.com.br/desconto/teste-ops).

## Distribuição das propostas

Uma loja conta em várias categorias; os totais descrevem apenas esta amostra intencional. Perfil comercial não entra nesta contagem.

| Categoria | Lojas propostas |
|---|---:|
| Alimentos e bebidas | 9 |
| Moda e acessórios | 9 |
| Beleza e cuidados pessoais | 10 |
| Saúde e bem-estar | 6 |
| Eletrônicos e informática | 8 |
| Casa e jardim | 11 |
| Esportes e fitness | 7 |
| Pets | 7 |
| Viagens e turismo | 4 |
| Livros e educação | 7 |
| Software e serviços digitais | 3 |
| Entretenimento e games | 6 |
| Automotivo | 7 |
| Presentes e flores | 1 |
| Finanças e seguros | 2 |
| Telefonia e internet | 2 |

## O que o piloto revelou

1. **Os nomes sozinhos são insuficientes.** 4seating é mobiliário; B.O.B. é cosméticos; “teste ops” não oferece identificação comercial suficiente.
2. **Múltiplas categorias têm casos concretos.** adidas e Decathlon cruzam Moda/Esportes; Airalo cruza Telefonia/Viagens; Allianz cruza Finanças/Viagens.
3. **A distinção loja/canal precisa ser explícita.** A página vinculada da Growth informa condições diferentes para o marketplace e o site próprio; qualquer filtro deve manter a oferta e suas regras independentes da categoria. [F30](https://www.cuponomia.com.br/desconto/gsuplementos).
4. **Não se deve confiar cegamente no catálogo de origem.** “Teste ops” aparece tanto na base quanto na página pública do Méliuz, sem evidência suficiente de um segmento. Isso justifica uma investigação própria, não sua exclusão automática. [F56](https://www.meliuz.com.br/desconto/teste-ops).
5. **A granularidade é decisão de produto.** Casa e jardim agrega móveis, obra e limpeza; Livros e educação agrega cursos e leitura. São simplificações candidatas que precisam ser avaliadas pelo usuário.

## Como expandir após a revisão

1. Revisar os 9 registros com atenção e as pendências específicas dos generalistas; confirmar fronteiras de suplementos, jardinagem e serviços domésticos.
2. Aprovar ou corrigir as demais propostas, registrando decisão por associação loja/categoria. Uma associação pode ser aprovada e outra recusada para a mesma loja.
3. Usar esse lote revisado como referência para avaliar o próximo lote. Medir propostas corrigidas, associações extras incorretas, associações faltantes e registros sem evidência; não usar a confiança autodeclarada da IA como acurácia.
4. Avançar em lotes de 50 com cache das fontes por domínio, limites de consulta e retomada. Reexaminar só lojas novas, evidências alteradas ou decisões sinalizadas.
5. Antes de generalizar, incluir segmentos pouco ou nada cobertos aqui, como lojas especializadas em eletrodomésticos, bebês/brinquedos, óticas e outras linhas presentes no inventário. A taxonomia é provisória até essa validação.
6. Só então especificar manifesto definitivo, persistência, tratamento no merge de aliases, invalidação de cache e filtro antes da paginação. O piloto não é uma migration nem um manifesto executável.

## Revisão dos generalistas e lacunas

| Loja | Antes | Agora: categorias comerciais | Perfil proposto |
|---|---|---|---|
| Mercado Livre | marketplaces | 11 | Generalista; opera marketplace |
| Magazine Luiza | marketplaces | 11 | Generalista; opera marketplace |
| AliExpress | marketplaces | 5 | Generalista; opera marketplace |
| Shopee | marketplaces | 11 | Generalista; opera marketplace |
| Carrefour | marketplaces; alimentos-bebidas | 9 | Generalista; opera marketplace |

Marketplaces podem aparecer em muitas categorias quando o sortimento sustenta isso. Nesta proposta, os cinco entram em Moda, que inclui calçados. A amplitude não é motivo para excluir; tampouco autoriza preencher toda a taxonomia.

- **Mercado Livre:** Software aparece como subcategoria, mas a oferta e o tipo de licença não foram examinados. Serviços de viagem/educação e consórcios citados no diretório requerem validar canal e identidade antes de associação adicional.
- **Magazine Luiza:** Beleza usa uma página com rastreamento informado de 8 meses; confirmar frescor antes de publicação. Links para seguros e consórcios do grupo não bastam para classificar esta loja em Finanças.
- **AliExpress:** Não desmembrar a menção conjunta saúde e beleza em Saúde sem exemplos específicos. Esportes, Pets, Livros, Alimentos e Games ainda precisam de evidência direta ou descrição comercial suficiente.
- **Shopee:** Viagens e bagagens não comprova reservas, passagens ou serviços turísticos; não atribuir Viagens por esse rótulo.
- **Carrefour:** Drogaria aparece como canal separado; Saúde aguarda avaliação específica. Livros e outros segmentos não foram confirmados nesta revisão.

O uso de diretórios prova a estrutura comercial observada; não mede permanência histórica ou estoque. A classificação proposta precisa ser revista quando as evidências mudarem. A menção a uma família agrupada, como Livros e educação, confirma o segmento observado (livros), não todos os componentes do rótulo.

Amazon foi exemplo conceitual na conversa e não integra as 50 lojas do snapshot; esta revisão preserva a amostra.

## Contrato dos dados de pesquisa

Schema versão 2. category_slugs lista as propostas; category_associations detalha fontes e aprovação de cada vínculo. Ambas as representações foram verificadas quanto à consistência. store_profile separa amplitude de sortimento e operação de marketplace; category_coverage=parcial impede interpretar omissões como exclusões comprovadas. As fontes antigas antes usadas em Marketplaces mantêm sua função de evidência de perfil por supports_profile.

Este JSON é material de pesquisa, não manifesto executável. Um futuro filtro de especialistas depende de pesquisar os perfis das demais lojas.

## Fontes e rastreabilidade

F01–F56 pertencem à pesquisa inicial de 09/09 BRT; F57 em diante foram consultadas na revisão de 10/09/2026. Consulta e abertura via ferramenta não garantem rastreamento no mesmo dia. Modalidades e idades de rastreamento disponíveis estão registradas em dados.json. Resumos são paráfrases e os vínculos são interpretações editoriais.

| ID | Fonte | Como foi examinada | Tipo |
|---|---|---|---|
| F01 | [Categorias e Seções no Mercado Livre](https://www.mercadolivre.com.br/categorias/) | Resultado de busca indexado | site oficial |
| F02 | [Compre agora \| Magazine luiza](https://especiais.magazineluiza.com.br/compre-agora/) | Resultado de busca indexado | site oficial |
| F03 | [AliExpress-Alibaba Group](https://www.alibabagroup.com/en-US/about-alibaba-businesses-1747705938191581184) | Resultado de busca indexado | controladora |
| F04 | [2025-04-17 - Form 20-F](https://cdn.sea.com/webmain/static/resource/seagroup/pressrelease/2024AR/NT8CQURDcqzIyTpTQ0SN/2025-04-17%20-%20Form%2020-F.pdf) | Resultado de busca indexado | controladora |
| F05 | [Bebidas: refrigerantes, vinhos, café, chás e mais - Mercado Carrefour \| Ofertas de Supermercado Delivery](https://mercado.carrefour.com.br/categoria/bebidas) | Resultado de busca indexado | site oficial |
| F06 | [Departamento de eletrodomésticos do Carrefour](https://www.carrefour.com.br/categoria/eletrodomesticos/) | Resultado de busca indexado | site oficial |
| F07 | [Loja Online Swift, compre agora e receba em casa](https://www.swift.com.br/) | Página aberta pela ferramenta web | site oficial |
| F08 | [Baggio Café \| Café Especial Premiado](https://baggiocafe.com.br/) | Resultado de busca indexado | site oficial |
| F09 | [Produtos - Ervas e Chás Casas Pedro – Casas Pedro](https://www.casaspedro.com.br/produtos/ervas-e-chas/casas-pedro) | Resultado de busca indexado | site oficial |
| F10 | [VINHOS: Don Simon, Portada, La Grupa e Mais \| Evino](https://www.evino.com.br/vinhos) | Resultado de busca indexado | site oficial |
| F11 | [Site Oficial da Tia Sônia - Amor, Sabor e Qualidade](https://www.tiasonia.com.br/) | Resultado de busca indexado | site oficial |
| F12 | [Calcados - Esportes De Areia \| adidas BR](https://www.adidas.com.br/calcados-esportes_de_areia) | Resultado de busca indexado | site oficial |
| F13 | [Acessórios Femininos \| Confira itens em Oferta - Renner](https://www.lojasrenner.com.br/c/feminino/acessorios/-/N-10ip4lqZwxqas2Z1hwylc0Z13df56z/) | Resultado de busca indexado | site oficial |
| F14 | [24S \| Luxury Fashion: designer clothes, bags & shoes](https://www.24s.com/en-us/women) | Resultado de busca indexado | site oficial |
| F15 | [24S — apresentação da LVMH](https://www.lvmh.com/en/our-maisons/selective-retailing/24s) | Resultado de busca indexado | controladora |
| F16 | [Lola Cosmetics - Escolha Lola, escolha ser feliz!](https://www.lolacosmetics.com.br/) | Resultado de busca indexado | site oficial |
| F17 | [Natura Brasil \| Perfumaria, maquiagem e muito mais](https://www.natura.com.br/) | Resultado de busca indexado | site oficial |
| F18 | [Pague Menos - Farmárcia Online](https://www.paguemenos.com.br/) | Resultado de busca indexado | site oficial |
| F19 | [CPAP - Glossário](https://www.cpaps.com.br/glossario/termo/CPAP) | Resultado de busca indexado | site oficial |
| F20 | [KaBuM! \| Ofertas em Tech e Gamer? Só se for no KaBuM!](https://www.kabum.com.br/) | Resultado de busca indexado | site oficial |
| F21 | [Loja Oficial Dell: Notebooks, PCs e Monitores \| Dell Brasil](https://www.dell.com/pt-br) | Resultado de busca indexado | site oficial |
| F22 | [Placa-mãe, Placas de Vídeo e Muito Mais \| Pichau](https://www.pichau.com.br/hardware?rgpu=742) | Resultado de busca indexado | site oficial |
| F23 | [Home Theater Seating \| Shop Home Theater Seats - 4seating.com](https://4seating.com/) | Resultado de busca indexado | site oficial |
| F24 | [Móveis para Cozinha: Cozinhas Completas e mais \| Madesa](https://www.madesa.com/pages/cozinhas) | Resultado de busca indexado | site oficial |
| F25 | [Materiais de Construção \| Leroy Merlin](https://www.leroymerlin.com.br/materiais-de-construcao/) | Resultado de busca indexado | site oficial |
| F26 | [Decoração — Leroy Merlin](https://www.leroymerlin.com.br/decoracao) | Página aberta pela ferramenta web | site oficial |
| F27 | [Inox em Panelas – Brinox](https://www.brinox.com.br/panelas/Inox/1295) | Resultado de busca indexado | site oficial |
| F28 | [Loja Oficial Brinox no Méliuz](https://www.meliuz.com.br/desconto/cupom-brinox) | Página aberta pela ferramenta web | plataforma cashback |
| F29 | [Decathlon \| Loja de artigos esportivos online - Ready to Play](https://www.decathlon.com.br/) | Resultado de busca indexado | site oficial |
| F30 | [Cupom Desconto Gsuplementos \| 10% OFF Setembro 2026](https://www.cuponomia.com.br/desconto/gsuplementos) | Página aberta pela ferramenta web | plataforma cashback |
| F31 | [Growth Supplements — vitrine marcada como Loja Oficial no Mercado Livre](https://www.mercadolivre.com.br/loja/growth-supplements) | Busca indexada; abertura direta bloqueada | vitrine marketplace |
| F32 | [Pet Shop Cobasi Cantareira Norte Shopping](https://www.cobasi.com.br/lojas/cobasi-cantareira-norte) | Resultado de busca indexado | site oficial |
| F33 | [Jardim — Cobasi](https://www.cobasi.com.br/c/jardim) | Página aberta pela ferramenta web | site oficial |
| F34 | [Petlove: o maior petshop online do Brasil](https://www.petlove.com.br/) | Resultado de busca indexado | site oficial |
| F35 | [Zee.Dog - Guias, coleiras, peitorais e acessórios para cachorros e gatos \| Zee.Dog - Conectando Cachorros e Pessoas](https://www.zeedog.com.br/) | Resultado de busca indexado | site oficial |
| F36 | [Booking.com \| Site oficial \| Os melhores hotéis, voos, aluguéis de carro e acomodações](https://m.booking.com/index.pt-br.html) | Resultado de busca indexado | site oficial |
| F37 | [Viagens de ônibus com mais conforto pelo menor preço \| Buser](https://www.buser.com.br/) | Resultado de busca indexado | site oficial |
| F38 | [eSIM Brasil, a partir de $4.00 USD \| A primeira loja eSIM do mundo · Airalo](https://www.airalo.com/pt-BR/brazil-esim/) | Resultado de busca indexado | site oficial |
| F39 | [Seguro Viagem Allianz \| Allianz Travel](https://www.allianztravel.com.br/) | Resultado de busca indexado | site oficial |
| F40 | [Formações em Tecnologia e Negócios \| Alura](https://www.alura.com.br/formacoes) | Resultado de busca indexado | site oficial |
| F41 | [Mais de 450 cursos online gratuitos - O melhor de 2026 \| Aprendizado e certificação na Udemy](https://www.udemy.com/pt/courses/free/) | Resultado de busca indexado | site oficial |
| F42 | [Leiturinha \| O maior clube de livros infantis do Brasil](https://leiturinha.com.br/) | Página aberta pela ferramenta web | site oficial |
| F43 | [Dicionários e Gramáticas \| Livraria Martins Fontes Paulista](https://www.martinsfontespaulista.com.br/livros/dicionarios-e-gramaticas/dicionarios-tematicos) | Resultado de busca indexado | site oficial |
| F44 | [Hospedagem de sites a partir de R$ 5,99/mês](https://www.hostinger.com/br/hospedagem-de-sites) | Resultado de busca indexado | site oficial |
| F45 | [Gerenciador de senhas para indivíduos e famílias \| 1Password](https://1password.com/pt/product/password-manager) | Resultado de busca indexado | site oficial |
| F46 | [AI Note Taker \| Transcrição de Reuniões AI Gratuita](https://www.notta.ai/pt) | Resultado de busca indexado | site oficial |
| F47 | [Disney+ Brasil \| Filmes, séries e esportes ilimitados](https://www.disneyplus.com/pt-br) | Resultado de busca indexado | site oficial |
| F48 | [Nuuvem \| A maior loja oficial de jogos da América Latina](https://www.nuuvem.com/br-pt/catalog/types/games.html) | Resultado de busca indexado | site oficial |
| F49 | [PneuStore \| Frete Grátis em Pneus Selecionados - Aproveite](https://www.pneustore.com.br/) | Resultado de busca indexado | site oficial |
| F50 | [Onde Usar a Tag Sem Parar: Locais e Benefícios](https://www.semparar.com.br/onde-usar) | Resultado de busca indexado | site oficial |
| F51 | [Flores. Floricultura Online, Cestas e Arranjos. Entregas em todo Brasil - Giuliana Flores](https://www.giulianaflores.com.br/todos-os-produtos/gtodosprod/) | Resultado de busca indexado | site oficial |
| F52 | [Parafuzo: Aplicativo de Faxina, Limpeza e Serviços Domésticos](https://parafuzo.com/) | Página aberta pela ferramenta web | site oficial |
| F53 | [Para quais países e moedas posso Enviar e Receber transferências com a Remessa Online?](https://ajuda.remessaonline.com.br/para-quais-paises-a-remessa-online-envia) | Resultado de busca indexado | site oficial |
| F54 | [Planos TIM Controle: Internet 5G, WhatsApp e Ligações Ilimitadas \| TIM Oficial](https://www.tim.com.br/sp-interior/para-voce/planos/controle) | Resultado de busca indexado | site oficial |
| F55 | [Condicionadores em Barra Naturais e Veganos \| Use B.O.B – Marcado "cabelo-ressecado"](https://www.usebob.com.br/collections/condicionador-em-barra/cabelo-ressecado) | Resultado de busca indexado | site oficial |
| F56 | [Página teste ops no Méliuz](https://www.meliuz.com.br/desconto/teste-ops) | Página aberta pela ferramenta web | plataforma cashback |
| F57 | [Diretório de categorias do Mercado Livre — revisão](https://www.mercadolivre.com.br/categorias) | Busca indexada; abertura direta bloqueada | site oficial |
| F58 | [Navegação comercial do Mercado Livre](https://lista.mercadolivre.com.br/categorias) | Resultado de busca indexado | site oficial |
| F59 | [Navegação e parceiros do Magalu](https://especiais.magazineluiza.com.br/compre-agora/) | Página aberta pela ferramenta web | site oficial |
| F60 | [Guia de categorias do Magalu — letra A](https://www.magazineluiza.com.br/categorias/) | Página aberta pela ferramenta web | site oficial |
| F61 | [Beleza e perfumaria — Magalu](https://www.magazineluiza.com.br/beleza-e-perfumaria/l/pf/) | Página aberta pela ferramenta web | site oficial |
| F62 | [Esporte e lazer — Magalu](https://www.magazineluiza.com.br/esporte-e-lazer/l/es/) | Página aberta pela ferramenta web | site oficial |
| F63 | [Livros — Magalu](https://www.magazineluiza.com.br/livros/l/li/) | Página aberta pela ferramenta web | site oficial |
| F64 | [Mercado — Magalu](https://www.magazineluiza.com.br/mercado/l/me/) | Página aberta pela ferramenta web | site oficial |
| F65 | [Pet Shop — Magalu](https://www.magazineluiza.com.br/pet-shop/l/pe/) | Página aberta pela ferramenta web | site oficial |
| F66 | [Saúde e cuidados pessoais — Magalu](https://www.magazineluiza.com.br/saude-e-cuidados-pessoais/l/cp/) | Página aberta pela ferramenta web | site oficial |
| F67 | [Games — Magalu](https://www.magazineluiza.com.br/games/l/ga/) | Página aberta pela ferramenta web | site oficial |
| F68 | [Diretório de categorias da Shopee Brasil](https://shopee.com.br/l/category/home) | Página aberta pela ferramenta web | site oficial |
| F69 | [Descrição do sortimento AliExpress no Méliuz](https://www.meliuz.com.br/desconto/cupom-aliexpress) | Página aberta pela ferramenta web | plataforma cashback |
| F70 | [Descrição da loja AliExpress no Cuponomia](https://www.cuponomia.com.br/desconto/aliexpress) | Página aberta pela ferramenta web | plataforma cashback |
| F71 | [Departamentos do Mercado Carrefour](https://mercado.carrefour.com.br/categoria/) | Busca indexada; abertura direta bloqueada | site oficial |
| F72 | [Departamentos e seleções Carrefour](https://www.carrefour.com.br/) | Busca indexada; abertura direta bloqueada | site oficial |
| F73 | [Sortimento de moda e esporte no Carrefour](https://www.carrefour.com.br/s/olympikus%20olympikus?map=ft) | Página aberta pela ferramenta web | site oficial |
| F74 | [Operação comercial Carrefour — Grupo Carrefour Brasil](https://grupocarrefourbrasil.com.br/news/carrefour-e-powerade-parceiros-dos-jogos-olimpicos-paris-2024-criam-experiencia-imersiva-para-os-consumidores) | Resultado de busca indexado | controladora |
