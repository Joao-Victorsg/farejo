# Ativação valida em uma consulta com p95 abaixo de 500 ms

## Contexto

A rota de ativação precisa revalidar a oferta no clique para não encaminhar uma página em cache por
um cashback já indisponível. Essa segurança não pode transformar o CTA principal em uma espera
perceptível nem colocar a escrita de telemetria no caminho obrigatório do redirecionamento.

## Decisão

O caminho crítico de `/go/[storeSlug]/[platformId]` contém uma única consulta parametrizada e
indexada. Ela resolve a loja canônica e a oferta pela plataforma, verifica atividade, janela de
frescor e destino permitido, e retorna somente a URL necessária ao redirect. Histórico, boost, logo,
aliases e estatísticas não são consultados.

A Function da Vercel executa na região mais próxima disponível da região do Postgres. A conexão usa
Supavisor em transaction mode e a role restrita definida para o redirecionamento. A consulta de
validação não usa a cache do catálogo, pois precisa observar o estado vigente.

Depois de uma validação bem-sucedida, a resposta de redirecionamento temporário é enviada sem esperar
a escrita da métrica. O incremento agregado é agendado com `after()` e permanece best-effort. Uma
falha nessa etapa não altera a resposta já entregue ao usuário.

O critério de aceite em ambiente de preview/produção é:

- p95 menor que 500 ms entre a entrada na rota e a resposta de redirect;
- timeout total de 1,5 segundo;
- resultado medido com chamadas frias e quentes representativas antes do lançamento.

Se o p95 ultrapassar 500 ms, a ativação não está pronta para lançamento e a causa precisa ser
otimizada. Se a validação ultrapassar o timeout ou falhar, a rota segue a falha segura definida para
ativação e não adivinha nem reutiliza destino antigo.

## Consequências

- Segurança de frescor acrescenta somente um lookup pequeno ao clique.
- Localidade entre Function e banco passa a ser configuração obrigatória da publicação na Vercel.
- Índices de slug e da chave loja/plataforma fazem parte da verificação de performance.
- Métrica lenta ou indisponível não degrada o CTA.
- Observabilidade registra duração e resultado da validação sem registrar segredo ou dados pessoais.
- O orçamento é testável e pode impedir o lançamento se o redirecionamento ficar perceptivelmente
  lento.
