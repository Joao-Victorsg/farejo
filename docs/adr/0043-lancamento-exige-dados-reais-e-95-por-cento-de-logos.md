# Lançamento exige dados reais e 95 por cento de logos

## Contexto

O frontend precisa reproduzir o handoff com dados reais, mas alguns recursos dependem de ocorrências
que podem não existir no dia do lançamento, como boost vigente, validade explícita ou histórico já
maduro. Exigir exemplos artificiais desses estados violaria o contrato do produto. Em contrapartida,
logos e aliases possuem trabalho inicial mensurável e influenciam diretamente a qualidade do
catálogo completo.

## Decisão

A publicação inicial do frontend exige cumulativamente:

- coleta bem-sucedida das cinco plataformas nas 24 horas anteriores;
- decisão `merge` ou `reject` para todos os candidatos de alias do carregamento inicial, incluindo os
  45 já conhecidos e os novos candidatos gerados sobre o primeiro conjunto de produção;
- ao menos uma tentativa de ingestão de logo para toda loja pública elegível;
- logo final publicado para no mínimo 95% das lojas públicas elegíveis; as demais usam o fallback de
  tile e inicial;
- cards, hero, busca, ranking, agregados, datas e páginas de loja sem valores demonstrativos ou
  hardcoded;
- smoke tests aprovados para rotas públicas, busca, ativação, redirects, sitemap e invalidação;
- comparação visual desktop aprovada contra o handoff atualizado; a validação mobile segue a
  entrega posterior definida na ADR-0044.

Boost, valor anterior, validade e gráfico de histórico aparecem somente onde o contrato de dados real
for suficiente. Não existe meta mínima de lojas com esses estados. Se nenhum boost real estiver
vigente, por exemplo, sua ausência no site é correta e não bloqueia o lançamento.

Os 5% restantes de logos não dispensam diagnóstico: a Action registra falha ou ausência de fonte e o
frontend comprova o fallback. A meta é medida depois da resolução de aliases e somente sobre lojas
que possuem ao menos uma oferta pública elegível.

## Consequências

- Fidelidade não é obtida fabricando estados operacionais inexistentes.
- A curadoria inicial deixa de carregar pendências conhecidas para a primeira publicação.
- Cobertura de logo tem um limiar objetivo sem exigir 100% de fontes externas perfeitas.
- Uma nova loja depois do lançamento pode aparecer primeiro com fallback e ser processada na Action
  automática seguinte.
- O lançamento depende da atualização e validação visual do handoff que ainda será fornecida pelo
  mantenedor.
