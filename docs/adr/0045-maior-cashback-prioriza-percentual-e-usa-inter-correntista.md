# Maior cashback prioriza percentual e usa Inter correntista

## Contexto

Além da ordem padrão por cobertura de plataformas definida na ADR-0016, o handoff oferece ao usuário
a ordenação “Maior cashback”. O catálogo contém recompensas percentuais e valores fixos em reais, que
não representam grandezas comparáveis. A preferência Inter também pode mudar a taxa efetiva exibida,
mas, pela ADR-0018, o toggle não pode mover lojas entre posições ou páginas.

## Decisão

A ordenação “Maior cashback” divide as lojas em dois grupos:

1. lojas com ao menos uma oferta percentual elegível;
2. lojas cujas ofertas elegíveis são exclusivamente de valor fixo.

O grupo percentual vem sempre primeiro. Dentro dele, a loja é ordenada de forma decrescente pelo
maior percentual elegível. Dentro do grupo de valor fixo, a loja é ordenada de forma decrescente pelo
maior valor em reais. Percentual e reais nunca são convertidos nem comparados diretamente.

Para obter uma ordem estável, a taxa Inter usada nessa ordenação é sempre a taxa de correntista,
independentemente da preferência local atual. Essa referência acompanha o estado inicial do produto,
que começa com “Correntista Inter” ligado. Desligar o toggle continua alterando taxas, destaques e
ordem das ofertas dentro de cada loja, mas não reordena lojas nem muda a paginação.

Empates usam, nesta ordem, a quantidade decrescente de plataformas elegíveis, o nome canônico e o
slug canônico. A opção “Mais plataformas” continua sendo a ordem padrão; “Maior cashback” é uma
escolha explícita do usuário.

## Consequências

- Uma oferta fixa numericamente alta nunca ultrapassa uma oferta percentual por conversão
  arbitrária.
- Lojas exclusivamente fixas continuam ordenadas de forma útil dentro do próprio grupo.
- O resultado é determinístico e não salta quando o toggle Inter muda.
- Para um usuário que desligou o Inter, a ordem “Maior cashback” pode refletir uma taxa condicional
  diferente da exibida no topo do card; o controle e a documentação visual precisam deixar claro que
  a preferência altera ofertas, não a ordem das lojas.
- Paginação permanece estável enquanto o catálogo e seus dados elegíveis não mudarem.
