# Popularidade futura parte de ativações agregadas

## Contexto

A primeira entrega não ordena nem rotula lojas por popularidade, mas começar a medir um sinal real
desde o lançamento evita que uma classificação futura tenha de partir do zero. Visualizações de
página e recarregamentos são sinais ruidosos; o clique em “Ativar” representa intenção mais forte e
já faz parte do fluxo principal do produto.

Registrar eventos individuais, identidade, IP ou cookies não é necessário para esse objetivo. O dado
também não é crítico a ponto de poder atrasar ou impedir o redirecionamento do usuário.

## Decisão

O farejô contabiliza ativações em agregado diário por loja canônica e plataforma. O modelo lógico
contém `day`, `store_id`, `platform_id` e `activations`, com uma única linha por combinação no dia.
Não são persistidos evento individual, usuário, IP, cookie, termo pesquisado, origem de navegação ou
User-Agent.

O botão “Ativar” continua abrindo uma nova aba, mas aponta para uma rota interna de redirecionamento,
por exemplo `/go/[storeSlug]/[platformId]`. O servidor valida que a combinação corresponde a uma
oferta pública elegível, tenta incrementar o agregado e redireciona para a `offers.url` vigente. Uma
falha de telemetria nunca bloqueia o redirecionamento.

A escrita usa uma credencial server-only distinta, com uma role `farejo_metrics` limitada ao
incremento desse agregado. Ela não recebe `service_role`, não acessa as tabelas operacionais além do
mínimo necessário e não é enviada ao navegador. Se uma função PostgreSQL for usada para o incremento,
ela permanece `security invoker`, tem execução revogada de `PUBLIC` e é concedida explicitamente
somente à role autorizada.

O agregado é privado e não participa da ordenação, da cache ou do contrato público na primeira
entrega. A dimensão de plataforma é preservada para permitir análises futuras por loja, por
plataforma ou por ambas. A janela e a fórmula de uma eventual classificação pública serão decididas
somente quando esse recurso entrar no produto.

## Consequências

- O projeto acumula um sinal real desde o lançamento sem criar perfil de usuário ou armazenar
  navegação individual.
- A rota interna de redirecionamento é uma exceção justificada à preferência por não criar APIs
  próprias; ela não expõe o catálogo e termina no mesmo link da plataforma.
- O clique passa por uma invocação server-side antes do destino, mas a gravação é best-effort e não
  entra no caminho de sucesso obrigatório.
- Cliques repetidos e bots podem inflar os contadores. Enquanto não houver controle de identidade ou
  abuso, o agregado é um sinal aproximado, não uma métrica antifraude.
- Tornar o sinal público no futuro exigirá definir janela, amostra mínima, desempates e mitigação de
  manipulação; nenhuma dessas regras é inferida agora.
- Como a telemetria não afeta a home nesta fase, uma ativação não invalida a cache do catálogo.
