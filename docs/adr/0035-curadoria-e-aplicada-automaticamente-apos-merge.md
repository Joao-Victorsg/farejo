# Curadoria é aplicada automaticamente após merge

## Contexto

O manifesto versionado no Git é a fonte das decisões humanas de merge e rejeição de aliases. Exigir
um disparo manual depois de cada merge criaria uma janela de divergência — ou divergência permanente
por esquecimento — entre a decisão aprovada na `master` e sua projeção operacional no Supabase.

Conflitos estruturais podem ser identificados por máquina. Em particular, se duas lojas que seriam
unificadas já possuem ofertas da mesma plataforma, o processo consegue detectar a ambiguidade, mas
não pode escolher automaticamente qual observação representa a loja correta.

## Decisão

Alterações no manifesto passam por validação automática ainda no pull request. Depois do merge na
`master`, uma GitHub Action dedicada é disparada automaticamente quando o caminho do manifesto tiver
mudado. O merge revisado é a autorização para projetar a curadoria no ambiente operacional; não há
um segundo disparo manual obrigatório.

A Action usa uma role Postgres exclusiva de manutenção, nunca a role de leitura do frontend nem uma
credencial enviada à Vercel. Ela reconcilia o manifesto com o Supabase de forma idempotente:

1. valida o manifesto e calcula o diff contra o estado vigente;
2. detecta conflitos usando o estado real do banco;
3. sem conflito, aplica aliases, ofertas, histórico, `crawl_state`, propriedade de logo, redirects e
   remoção da loja absorvida em uma única transação;
4. verifica que o estado materializado corresponde ao manifesto;
5. somente após o commit bem-sucedido, invalida o catálogo pelo endpoint HMAC.

Qualquer conflito ou erro aborta a transação inteira, marca a Action como falha e preserva o estado
anterior. A resolução é feita por uma nova decisão humana no manifesto. O workflow também oferece
`workflow_dispatch` apenas para repetição ou recuperação operacional excepcional.

## Consequências

- Git e Supabase convergem automaticamente após uma decisão revisada.
- Detectar uma ambiguidade é automático; decidir como resolvê-la continua sendo curadoria humana.
- O scraper consome somente `store_aliases` já materializado e nunca lê o manifesto em runtime.
- O workflow de curadoria não tem cron e permanece separado da Action de scraping da Fase 2.
- Uma Action falha deixa explícito que a decisão no Git ainda não foi aplicada, sem produzir estado
  parcial no catálogo.
- Branch protection e revisão do manifesto tornam-se parte da proteção contra merges destrutivos.
