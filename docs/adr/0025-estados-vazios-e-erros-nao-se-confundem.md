# Estados vazios e erros não se confundem

## Contexto

Busca sem resultado, loja temporariamente sem oferta, catálogo anormalmente vazio e falha de leitura
do banco são situações diferentes. Reutilizar o mesmo estado vazio esconderia incidentes como se
fossem ausência legítima de dados e poderia afirmar incorretamente que uma loja não existe.

Navegações por busca e paginação também precisam preservar o layout enquanto o Server Component da
próxima URL é carregado.

## Decisão

Busca ou paginação em carregamento exibe skeletons com dimensões equivalentes aos cards finais,
preservando o espaço e evitando mudança de layout. A estrutura global de navegação e rodapé continua
visível.

Uma busca sem correspondência é um vazio legítimo: mantém o termo pesquisado, informa que nenhuma
loja com cashback disponível foi encontrada e oferece limpar a busca. Um catálogo completo sem
consulta e sem nenhuma loja elegível é uma anomalia de dados, não o mesmo vazio de busca.

Falha ao consultar o Supabase preserva a estrutura da página, mostra mensagem acionável e oferece
“Tentar novamente”. Ela não produz `404`, não informa que a loja está indisponível e não renderiza
uma lista vazia. Detalhes técnicos, stack traces, credenciais e mensagens cruas do banco nunca são
expostos ao visitante.

Loja canônica sem oferta segue a ADR-0023. Oferta atrasada segue a ADR-0015. Uma plataforma sem
percentuais elegíveis exibe “Sem taxa percentual disponível” nos campos de média e pico; ausência
de dado nunca vira `0%`.

Atualizações assíncronas da quantidade de resultados e mensagens de erro são anunciadas de forma não
intrusiva para tecnologias assistivas. O foco permanece previsível durante busca, paginação e retry.

## Consequências

- Um incidente de dados não fica mascarado como estado normal do produto.
- Skeletons representam a forma final e não inventam conteúdo ou valores.
- Rotas podem ter `loading` e `error` próprios sem duplicar nav e footer.
- Mensagens de vazio e erro sempre oferecem um próximo passo coerente.
- Testes precisam cobrir vazio de busca, página fora do intervalo, catálogo anormalmente vazio,
  falha de banco, loja indisponível e estatística sem percentual como estados distintos.
