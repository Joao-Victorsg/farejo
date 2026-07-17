# Estatísticas de plataforma não misturam percentual e valor fixo

## Contexto

A página `/plataformas` do handoff mostra, para cada plataforma, quantidade de lojas, média e pico.
O catálogo contém recompensas percentuais, valores fixos e percentuais anunciados como “até”. Uma
agregação ingênua produziria números sem unidade coerente ou apresentaria tetos condicionais como
retorno garantido.

## Decisão

“Em N lojas” é a contagem de lojas canônicas distintas com uma oferta pública elegível naquela
plataforma. Entram ofertas percentuais e de valor fixo, desde que estejam ativas e dentro da janela
de frescor da ADR-0015. Ofertas expiradas não contam.

“Média anunciada” é a média aritmética por loja somente das ofertas com `reward_type = 'percent'`.
Cada loja tem o mesmo peso. Valores fixos, independentemente da moeda, ficam fora desse cálculo e
nunca são convertidos para percentual.

Uma oferta `is_upto` entra na média com o teto percentual anunciado. Por isso, o rótulo e o texto de
apoio deixam explícito que se trata de média dos valores anunciados, não de retorno esperado ou
garantido.

“Pico” é o maior percentual anunciado entre as mesmas ofertas elegíveis. O resultado preserva o
sinal `is_upto`: quando a oferta vencedora for um teto, a interface mostra “Até X%”, e não apenas
“X%”. Se não houver oferta percentual elegível, média e pico ficam ausentes em vez de receber zero
ou incorporar valores fixos.

Os três agregados usam somente o snapshot atual de `offers`; o histórico não participa. A resolução
de aliases acontece antes da contagem, para que uma loja canônica não seja duplicada.

## Consequências

- Uma plataforma com cashback exclusivamente fixo ainda mostra sua cobertura em lojas, mas não ganha
  média ou pico percentual artificiais.
- Plataformas com muitos valores “até” podem ter média anunciada maior sem que isso represente o
  retorno típico; a linguagem da interface precisa preservar essa distinção.
- Contagem, média e pico obedecem à mesma política pública de frescor usada no catálogo.
- O contrato da página precisa transportar, além do valor do pico, se ele é `up_to`.
- Nenhuma taxa histórica, mediana de boost ou conversão entre `%` e moeda entra nesses cards.
