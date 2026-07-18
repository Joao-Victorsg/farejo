# Action de logos separa banco e Storage sem service_role

## Contexto

A Action automática de logos precisa ler fontes privadas, publicar arquivos no Supabase Storage e
trocar o ponteiro final da loja. Reutilizar a `service_role` do pipeline daria ao processador de
imagens privilégios desnecessários sobre ofertas, aliases, histórico e demais objetos operacionais.

O Supabase oferece chaves compatíveis com S3 para operações server-side. Elas acessam todas as
operações e buckets de Storage e ignoram RLS, portanto não são credenciais apropriadas para browser
nem equivalem a uma chave limitada a um único objeto. Ainda assim, separam completamente Storage do
acesso ao Postgres.

## Decisão

A Action usa duas credenciais independentes:

- uma conexão Postgres com a role `farejo_logo_writer`, limitada a ler e atualizar o estado de
  `store_logo_sources` e a atualizar somente `stores.logo_url` e `stores.logo_hash`;
- um par de chaves S3 do Supabase, usado exclusivamente para o bucket público `store-logos`.

Essas credenciais ficam como secrets do GitHub Environment do workflow de logos. Não são copiadas
para Vercel, arquivos versionados, logs, artefatos ou outputs. A Action não recebe `service_role`,
credencial de curadoria, `farejo_web`, segredo HMAC de origem diferente do necessário para invalidar
o catálogo, nem qualquer segredo do frontend.

O projeto mantém somente o bucket de logos nesta etapa. A chave S3 continua tecnicamente capaz de
operar em todos os buckets do projeto; se outros buckets forem criados, essa decisão precisa ser
reavaliada. Objetos usam caminhos por hash, e a rotina normal não apaga versões antigas. Em caso de
comprometimento ou exclusão, a chave é rotacionada e os logos podem ser regenerados das fontes
persistidas.

Downloads do bucket são públicos. Upload, substituição de ponteiro e estado de processamento ficam
restritos à Action. Não se cria uma conta técnica no Supabase Auth apenas para obter um JWT com RLS,
pois o ciclo de login e sessão adicionaria complexidade desproporcional neste MVP.

## Nota (18/07/2026)

A implementação do provisionamento do bucket (T14, #60) revalidou esta decisão contra o stack
local (`@aws-sdk/client-s3` apontando para `supabase start`) e contra a documentação vigente do
Supabase (`guides/storage/s3/authentication`): a chave de acesso S3 continua concedendo acesso a
todas as operações e buckets do projeto e ignorando RLS, sem escopo por bucket disponível na
plataforma atual. Nada mudou desde a decisão original; nenhuma revisão de escopo é necessária.

## Consequências

- Comprometer a credencial de imagem não permite alterar cashback, aliases ou histórico.
- A chave S3 permanece um segredo poderoso sobre Storage e exige rotação e proteção operacional.
- A role Postgres precisa de grants por tabela e coluna, sem default privileges amplos.
- O workflow deve testar que não consegue escrever em ofertas nem ler objetos fora do contrato.
- Um novo bucket futuro não pode assumir isolamento diante da mesma chave S3.
