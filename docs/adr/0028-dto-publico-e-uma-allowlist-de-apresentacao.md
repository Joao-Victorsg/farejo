# DTO público é uma allowlist de apresentação

## Contexto

O Next.js consulta o Supabase no servidor, mas isso não significa que linhas completas do banco
precisem ser serializadas para os Client Components ou incorporadas no HTML. O schema operacional
contém textos crus, URLs de origem, dados de coleta e metadados úteis para diagnóstico que não fazem
parte do produto público.

A rota interna de ativação também elimina a necessidade de distribuir antecipadamente cada
`offers.url` nas páginas.

## Decisão

O DTO enviado ao navegador é uma allowlist própria para apresentação. Para loja, contém slug
canônico, nome, logo final, quantidade de plataformas e frescor agregado. Para oferta, contém
plataforma, tipo de recompensa, `value`, `value_partial`, `is_upto`, frescor e os campos públicos
derivados de boost, valor típico, valor anterior e validade verdadeira quando existirem.

O CTA recebe apenas o caminho interno `/go/[storeSlug]/[platformId]`. `offers.url` é resolvida no
servidor após validar que a oferta continua pública e elegível. A URL externa não é tratada como
segredo — o redirecionamento necessariamente a revela —, mas não integra o contrato das páginas.

O histórico público é uma série já limitada aos 60 dias mais o ponto âncora necessário. O navegador
não recebe as linhas brutas completas da tabela.

Não são serializados: `raw_text`, URLs originais de logo, hashes, ETags, estados de ingestão,
inventário de aliases, candidatos ou rejeições de curadoria, `scrape_runs`, `crawl_state`, notas,
erros ou campos internos sem uso na interface.

As views e roles de leitura no banco continuam seguindo privilégio mínimo. Dados que o servidor
precisa para busca ou resolução de redirecionamento podem existir em contratos internos separados,
sem passar para o DTO do cliente.

## Consequências

- Componentes não ficam acoplados ao formato físico das tabelas.
- Adicionar uma coluna operacional não a torna pública por acidente.
- A mesma projeção pode validar tipos e nulabilidade antes de cruzar a fronteira servidor-cliente.
- Busca, ingestão de logos e diagnóstico permanecem server-only.
- A ativação sempre passa pela validação e contabilização definidas na ADR-0017.
- Testes de contrato podem afirmar explicitamente quais campos são permitidos e rejeitar vazamento de
  campos operacionais.
