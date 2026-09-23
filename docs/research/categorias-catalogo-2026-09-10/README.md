# Expansão das categorias para o catálogo completo

Preparado em 10/09/2026. **Status: inventário, fila de pesquisa e proposta de integração preparados. A pesquisa individual de todas as lojas ainda não foi executada.**

## Cobertura

| Estado | Registros |
|---|---:|
| Inventário total | 1.021 |
| Elegíveis no snapshot | 963 |
| Sem elegibilidade no snapshot | 58 |
| Com proposta reaproveitável do piloto | 49 |
| Inconclusivo no piloto | 1 |
| Sondagem inicial para ampliar taxonomia | 3 |
| Sem pesquisa individual | 968 |

As três sondagens (Ri Happy, eÓtica e Bulbe Energia) apontam lacunas da taxonomia; não são classificações completas. Os 971 registros fora do piloto foram organizados em 20 lotes de até 50, priorizando elegibilidade e quantidade de plataformas. O teste ops permanece na revisão dos inconclusivos do piloto.

## Arquivos

- [Plano de implementação e direção de dropdown escolhida](plano-implementacao.md).
- [Referências de navegação pesquisadas](referencias-navegacao.md).
- [Proposta de experiência, arquitetura e pesquisa](proposta-site.md).
- [Snapshot integral de lojas, aliases e URLs públicas](inventario.json).
- [Fila por loja, com estado e lote](fila-pesquisa.json).
- [Consulta SQL somente de leitura](consultas.sql).
- [Piloto revisado de referência](../categorias-piloto-2026-09-09/README.md).

## Direção proposta

Categorias amplas como ponto de partida; uma categoria selecionada por vez no filtro, independentemente de cada loja poder pertencer a várias. A profundidade foi apresentada ao usuário como escolha entre categorias amplas e categorias com subcategorias. O documento usa categorias amplas como recomendação, não registra a resposta como recebida.

A proposta foi confrontada com a home, controles, busca, paginação, read model SQL e cache existentes. O esboço na conversa usa uma seleção de lojas do piloto para experimentar filtros; não é uma página implementada ou catálogo completo.

## Implementação na branch `codex/categorias-lojas`

O schema aditivo, a busca por categoria, o dropdown e a aplicação transacional do manifesto estão implementados e validados localmente com dados sintéticos. Nenhuma associação do piloto foi publicada: suas propostas seguem pendentes de revisão e a pesquisa individual do inventário ainda precisa ser concluída. O dropdown só aparece quando houver categorias ativas curadas no banco.

O manifesto aprovado deverá ficar em `curation/categories-manifest.json`. Cada associação registra URL pública, data de consulta e justificativa. Para verificar o diff sem gravar: `pnpm --filter @farejo/scraper curate:categories --dry-run [caminho-do-manifesto]`. Para aplicar após revisar o diff: `pnpm --filter @farejo/scraper curate:categories --apply [caminho-do-manifesto]`. A aplicação confirma o estado materializado, registra a revisão e invalida o cache; uma repetição da revisão também repete a invalidação. No deploy de produção, a Action de categorias aguarda a migration e o deploy terem sucesso e só roda se o manifesto aprovado existir na revisão publicada.
