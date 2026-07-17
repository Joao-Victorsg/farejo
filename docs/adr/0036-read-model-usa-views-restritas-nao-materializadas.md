# Read model usa views restritas não materializadas

## Contexto

O Next.js precisa ler dados públicos do catálogo sem receber privilégios sobre tabelas operacionais.
As consultas do MVP cobrem aproximadamente mil lojas, cinco plataformas, detalhes pontuais e uma
janela limitada de histórico. Introduzir materialized views desde o início acrescentaria outro estado
a publicar e sincronizar depois de scrapes e curadorias antes de haver evidência de necessidade.

## Decisão

O schema não exposto `web_read` contém views normais, estreitas e voltadas aos casos de apresentação,
busca e agregação do frontend. Elas não são materializadas na primeira entrega.

As views pertencem a uma role `NOLOGIN` de leitura, com somente os grants de tabelas e as policies RLS
necessárias para produzir essas projeções. Ela não é `postgres`, `service_role` nem dona das tabelas
operacionais. As views usam nomes de objetos qualificados e uma configuração defensiva que impede
objetos controlados pelo chamador de participarem da resolução das consultas.

A role de runtime `farejo_web` recebe somente `USAGE` no schema `web_read` e `SELECT` nas views
explicitamente listadas. Ela não recebe `USAGE` nos schemas operacionais nem `SELECT`, `INSERT`,
`UPDATE`, `DELETE` ou `EXECUTE` sobre tabelas e funções internas. `anon`, `authenticated` e o Data API
continuam sem acesso a esse schema.

O Next.js consulta as views com parâmetros, limites obrigatórios e paginação determinada pelo
servidor. Um `statement_timeout` curto limita consultas defeituosas. O cache do Next.js absorve
leituras repetidas; uma projeção materializada só será introduzida depois de medição que demonstre
que índices, queries e cache normais não atendem aos objetivos.

A ativação não usa `farejo_web`. `/go` possui uma role e uma operação dedicadas, pois precisa resolver
o destino externo vigente e registrar telemetria best-effort sem ampliar os privilégios das páginas.

## Consequências

- Comprometer a credencial de leitura não concede acesso direto ao schema operacional nem escrita.
- O formato das tabelas internas não atravessa automaticamente o contrato do frontend.
- Não há refresh de materialized view para coordenar com scrape, curadoria ou invalidação de cache.
- Busca e agregações precisam de índices nas colunas e expressões realmente usadas.
- Performance é medida com o volume real antes de adicionar uma segunda projeção persistida.
- Migrations e testes devem verificar grants, policies, ausência de default privileges permissivos e
  os campos expostos por cada view.
