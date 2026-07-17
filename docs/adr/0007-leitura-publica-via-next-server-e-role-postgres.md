# Leitura pública via Next.js server e role PostgreSQL dedicada

## Contexto

O farejô é um site público, sem login, mas isso não exige expor o Supabase Data API ao
navegador. Os dados renderizados são públicos; a superfície de consulta do banco, suas colunas
internas e sua cota não precisam ser. O App Router também separa componentes executados no
servidor dos componentes enviados ao browser.

A decisão genérica do ADR-0002 de usar `anon`/RLS no web fica substituída por esta fronteira mais
restritiva. A `service_role` permanece exclusiva do pipeline da Fase 2.

## Decisão

O navegador nunca acessa o Supabase diretamente e não recebe URL de conexão, publishable key,
senha PostgreSQL ou `service_role`. Páginas e layouts consultam os dados em Server Components do
Next.js, no runtime da Vercel, e entregam ao browser apenas o DTO necessário para renderização e
interações locais.

O runtime da Vercel conecta ao PostgreSQL pelo Supavisor em transaction mode, usando uma role
dedicada, `farejo_web`, e uma credencial própria. Essa role:

- é `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` e `NOREPLICATION`;
- opera somente em leitura, com timeout curto;
- não recebe privilégios nas tabelas operacionais nem nos schemas internos;
- recebe apenas `USAGE` e `SELECT` sobre views explícitas de um schema de leitura, `web_read`;
- não pode gravar ofertas, histórico, aliases, runs ou estado de crawl.

O schema `web_read` não é exposto pelo Data API. Suas views formam o contrato público e projetam
somente os campos necessários para cards, detalhes, plataformas, histórico e estatísticas. Busca,
ordenação e paginação usam queries parametrizadas, limites impostos pelo servidor e índices
adequados; não há concatenação de SQL com entrada do usuário.

A busca pública usa navegação GET com `?q=` e renderização no servidor. `/api/search` não é
necessária para sustentar o campo, o botão “Buscar” e a filtragem da grade descritos no handoff.

Na Vercel, a connection string é uma variável sensível sem prefixo `NEXT_PUBLIC_`, importada
somente por módulo marcado `server-only`. Production e Preview não compartilham a mesma
credencial nem o mesmo banco de dados.

## Data API e privilégios existentes

O Data API pode permanecer habilitado na extensão necessária ao pipeline já concluído, mas não é
um canal de leitura do frontend:

- `anon` e `authenticated` não recebem leitura das tabelas nem policies públicas de RLS;
- `PUBLIC`, `anon` e `authenticated` não recebem execução das funções operacionais;
- default privileges são revogados para que novos objetos não sejam expostos por acidente;
- `pipeline_write_offers` continua executável somente pela `service_role`.

A Fase 2 já versionou o endurecimento dessas funções: revogou `EXECUTE` de `PUBLIC`, `anon` e
`authenticated` em `pipeline_write_offers` e `rls_auto_enable`, fixou o `search_path` da função de
escrita e preservou execução somente para `service_role` (T17/#34). A Fase 3 mantém essa fronteira;
não precisa reabrir ou refazer o hardening.

## Decisão anterior substituída

A menção a web com `anon`/RLS apareceu na spec e no cliente compartilhado da Fase 1 como uma ponte
para uma fase futura, não como resultado de uma comparação entre Data API e conexão PostgreSQL.
Naquela fase o frontend estava explicitamente fora de escopo. O próprio system design já escolhia
Next.js com queries no servidor e rejeitava SPA + PostgREST. Este ADR fecha a ambiguidade a favor
da conexão PostgreSQL server-only e substitui apenas a previsão de credencial web do ADR-0002; a
separação de configuração entre apps continua válida.

## Cache e ciclo de execução

“Serverless” descreve o processo que atende um cache miss, uma busca ou uma revalidação; não
significa que o site fica offline quando não há tráfego. HTML/RSC e assets cacheados permanecem
disponíveis na infraestrutura da Vercel. Instâncias de função são efêmeras e podem ser criadas,
reutilizadas ou encerradas, portanto a aplicação não depende de memória ou conexão local
persistente.

O Supavisor evita que invocações temporárias monopolizem conexões do Postgres. Prepared
statements ficam desabilitados no transaction mode. As leituras de banco ocorrem somente em cache
misses, buscas e revalidações; páginas cacheadas não consultam o Supabase a cada visita. A política
exata de tags, TTL e invalidação pós-scrape será decidida separadamente neste grill.

## Consequências

- Não existe chave Supabase no bundle do navegador nem cliente `supabase-js` no código client.
- Uma falha da role web tem blast radius limitado às projeções públicas, somente leitura.
- Conteúdo já renderizado continua copiável por qualquer visitante; essa decisão protege o banco
  e sua superfície de consulta, não tenta tornar confidencial um site público.
- O web passa a usar um driver PostgreSQL server-only e precisa respeitar as restrições do
  Supavisor transaction mode.
- Consultas de rota devem evitar N+1 e retornar DTOs mínimos; estado puramente interativo, como o
  toggle Inter, trabalha no browser sobre valores já serializados.
