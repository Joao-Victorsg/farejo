# Agregados do Inter usam a taxa de correntista

## Contexto

As ofertas do Inter guardam `value` para correntistas e `value_partial` para não correntistas. Nos
cards e no detalhe de uma loja, o toggle local escolhe a taxa efetiva e reordena as plataformas. A
página `/plataformas`, porém, apresenta um panorama agregado e não possui esse controle visível.
Personalizar média e pico por uma preferência invisível faria o mesmo card mostrar números diferentes
sem explicar a causa e reduziria o compartilhamento de cache.

## Decisão

Contagem, média anunciada e pico do Inter em `/plataformas` usam `value`, a taxa de correntista e o
padrão inicial do produto. `value_partial` não entra nesses agregados.

O card identifica que as taxas agregadas do Inter são para correntistas. A preferência persistida no
navegador não altera essa página; seu efeito fica restrito às ofertas dentro dos cards de loja e do
ranking no detalhe, conforme a ADR-0018.

As demais regras da ADR-0019 permanecem válidas: apenas percentuais entram em média e pico, valores
fixos contam somente na cobertura e o sinal “até” é preservado.

## Consequências

- `/plataformas` tem uma representação única e compartilhável para todos os visitantes.
- O resultado pode ser cacheado sem variar por `localStorage`, cookie ou parâmetro de usuário.
- A condição de correntista precisa estar visível no card para que os números não pareçam universais.
- A taxa parcial continua disponível onde o usuário consegue controlá-la e observar seu efeito no
  ranking de uma loja.
