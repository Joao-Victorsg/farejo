# Publicação coordena migration e deploy sem staging

## Contexto

O farejô terá somente um Supabase remoto, de produção. Se a integração Git da Vercel publicar o novo
frontend ao mesmo tempo que outro processo aplica migrations, o código pode chegar ao ar antes das
views, colunas ou roles das quais depende. Sem staging remoto, a reversibilidade precisa vir da ordem
do rollout e da compatibilidade das mudanças.

## Decisão

Um workflow de produção é o único responsável pela publicação. O auto-deploy concorrente da
integração Git da Vercel fica desabilitado. Para uma revisão aprovada na `master`, o workflow:

1. executa testes, typecheck e build com as versões fixadas pelo monorepo;
2. aplica migrations aditivas no Supabase de produção;
3. verifica schema, views, roles, policies e grants esperados;
4. publica na Vercel exatamente o artefato já construído e validado;
5. executa smoke tests nas rotas públicas e registra o resultado.

Falha de migration ou de sua verificação bloqueia o deploy. Falha durante ou depois do deploy permite
rollback do frontend para o deployment anterior; as mudanças aditivas do banco permanecem, pois são
compatíveis com esse frontend anterior.

Nenhuma tabela, coluna, view ou contrato consumido pela versão anterior é removido na mesma
publicação que introduz seu substituto. Mudança destrutiva, se futuramente necessária, ocorre somente
em uma publicação posterior, depois que a compatibilidade com rollback deixar de exigir o objeto
antigo.

O workflow usa segredos de Production com escopo mínimo. Deployments Preview continuam sem conexão
remota e não participam desse gate.

## Consequências

- Migration e frontend não disputam uma corrida após o merge.
- O banco pode avançar antes do web sem derrubar a versão ainda publicada.
- Rollback da Vercel não exige rollback emergencial de schema.
- O artefato publicado é o mesmo que passou pelos checks, sem rebuild divergente.
- O workflow de publicação passa a ser infraestrutura crítica e precisa impedir execuções
  concorrentes para o mesmo ambiente.
