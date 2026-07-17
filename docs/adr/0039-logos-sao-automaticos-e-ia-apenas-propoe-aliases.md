# Logos são automáticos e IA apenas propõe aliases

## Contexto

O pipeline já observa URLs de logo durante o scrape e passará a persistir essas fontes. Exigir que o
mantenedor execute diariamente um comando separado deixaria lojas novas no fallback sem necessidade.
Ao mesmo tempo, falhas de imagem não devem atrasar nem mudar o resultado da coleta de cashback.

A geração de candidatos de alias também pode ser enriquecida com IA. Contudo, a confiança declarada
por um modelo não é uma probabilidade calibrada de identidade. Um falso merge tem consequência de
produto maior que um merge perdido: compara ofertas de lojas diferentes como se fossem uma só.

## Decisão

Uma GitHub Action de logos, separada da Action `Scrape cashback`, é disparada automaticamente após a
conclusão desta. Ela consulta `store_logo_sources` e processa somente fontes novas, alteradas ou ainda
sem resultado final. Na ausência de pendências, encerra sem downloads ou uploads.

A Action baixa candidatos com os controles de segurança já definidos, seleciona a melhor fonte,
normaliza para WebP, publica no Supabase Storage e atualiza atomicamente o ponteiro final somente após
upload bem-sucedido. Se algum `stores.logo_url` mudar, invalida o catálogo. Falha de logo mantém o
último arquivo válido ou o fallback e não altera o resultado do workflow de scraping.

Logos não esperam a conclusão da curadoria de aliases. Cada loja canônica vigente pode receber um
logo. Se um merge for aprovado depois, a reconciliação reúne as fontes, preserva ou seleciona o melhor
arquivo do cluster e evita duplicação de conteúdo pelo hash.

Para aliases, regras determinísticas conservadoras continuam sendo a primeira etapa. Trigram, nomes,
URLs, plataformas e sinais visuais podem gerar evidências para candidatos. Uma IA pode ordenar e
explicar esses candidatos e produzir uma proposta estruturada, mas nunca grava `store_aliases`, nunca
altera o banco e nunca faz merge automaticamente.

A automação abre um pull request propondo `merge` ou `reject` no manifesto. A decisão só se torna
válida depois da revisão humana e do merge do PR; então a Action de curadoria definida na ADR-0035 a
aplica automaticamente ao Supabase. Pendências aparecem no resumo da Action e no PR. Uma notificação
via Telegram poderá futuramente apontar para essa revisão, sem se tornar fonte de verdade.

## Consequências

- Lojas novas ganham logo sem intervenção diária do mantenedor.
- Processamento de imagem não entra no caminho crítico nem no status do scraping.
- IA reduz trabalho de triagem, mas não enfraquece a regra de nunca fazer fuzzy auto-merge.
- O Git continua sendo o registro auditável das decisões humanas.
- Falha ou indisponibilidade do classificador não pode impedir a coleta, os logos ou a leitura pública.
- O workflow de logos precisa de credenciais próprias e restritas, nunca de segredos da Vercel.
