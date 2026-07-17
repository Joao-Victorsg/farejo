# Preview não acessa nenhum banco remoto

## Contexto

O farejô é inicialmente um projeto pessoal e os deployments Preview serão pouco usados. Manter um
segundo projeto Supabase apenas para previews acrescentaria sincronização e operação sem benefício
proporcional. Conectar código ainda não publicado ao banco de produção, mesmo com uma role de
leitura, acrescentaria risco ao pool de conexões e à credencial real.

## Decisão

Existe um único projeto Supabase remoto, destinado exclusivamente à produção. Desenvolvimento e
testes de integração usam o Supabase local.

Deployments Preview da Vercel não recebem connection string, senha Postgres, `service_role`, segredo
HMAC, credencial de curadoria ou permissão de Storage. Eles não consultam o banco de produção e não
possuem um banco remoto alternativo.

Preview não é ambiente de homologação nem gate de lançamento na primeira entrega. Se um deployment
Preview for gerado, funcionalidades dependentes do catálogo podem permanecer indisponíveis de forma
controlada; nunca existe fallback silencioso para produção. O fluxo normal publica a partir da
`master` depois da validação local e automatizada prevista para o repositório.

Um ambiente remoto separado só será reconsiderado se colaboração frequente, homologação remota ou
mudanças operacionais mais arriscadas passarem a justificar seu custo de manutenção.

## Consequências

- Nenhum código de branch recebe credencial válida do banco de produção.
- Não há custo nem sincronização de um projeto Supabase de staging.
- Revisão visual e integração completa antes do merge acontecem localmente.
- Preview não é adequado para demonstrar o catálogo real ou testar `/go`.
- A publicação em produção precisa usar migrations compatíveis com rollback do frontend, pois não há
  um ambiente remoto intermediário.
