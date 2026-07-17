# Toggle Inter também aparece no detalhe da loja

## Contexto

O handoff coloca o controle “Correntista Inter” na barra de ordenação da home e faz a página de
detalhe herdar a preferência persistida. Porém, quem chega diretamente a `/loja/[slug]`, por busca,
link compartilhado ou mecanismo de pesquisa, não tem como informar que não é correntista sem voltar
ao catálogo.

## Decisão

A página de detalhe também exibe um controle compacto “Correntista Inter” junto ao cabeçalho
“Ranking de cashback”. O controle representa a mesma preferência global da home, usa o mesmo estado
persistido e não cria uma configuração por loja.

Alternar no detalhe atualiza imediatamente a taxa Inter, a posição da oferta no ranking, o destaque
de melhor oferta e a série histórica correspondente, quando houver base suficiente. A loja, a URL e
as demais preferências não mudam. Ao voltar para a home, o toggle aparece no mesmo estado.

O estado inicial continua ligado. Texto e estado visual deixam claro se a taxa exibida é para
correntista ou não correntista, sem depender apenas da posição do switch.

## Consequências

- A preferência pode ser corrigida sem abandonar a página acessada diretamente.
- Home e detalhe precisam compartilhar uma única fonte de estado no frontend.
- Os dois controles devem permanecer sincronizados durante navegação no cliente.
- O handoff desktop precisa acrescentar o controle compacto no cabeçalho do ranking.
- A ordenação das lojas continua independente do toggle, conforme as ADRs 0018 e 0045.
