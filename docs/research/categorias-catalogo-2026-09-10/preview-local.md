# Prévia local de categorias

Esta prévia usa **somente o Supabase local**. Ela não é o manifesto de produção: as associações do piloto permanecem pendentes de revisão ampla. O script local considera apenas lojas do piloto sem ressalvas editoriais, com fonte oficial que menciona a categoria. Lojas sem categoria continuam em “Todas as lojas”.

Após `pnpm db:start` e as migrations locais, execute da raiz:

```powershell
pnpm --filter @farejo/scraper preview:local:scrape
pnpm --filter @farejo/scraper preview:local:tiered
pnpm --filter @farejo/scraper preview:local:categories
```

A primeira coleta as plataformas de um request (Inter, MyCashback e Zoom). A segunda verifica apenas os generalistas Mercado Livre, Shopee, Magazine Luiza e Carrefour em Cuponomia e Méliuz, respeitando o throttle dos adapters. A terceira lê o piloto, cruza slugs com as lojas materializadas no banco local e aplica apenas as associações sustentadas por fontes oficiais. Nenhum script usa credencial ou URL de produção.

Para iniciar o site com a role de leitura local, defina `FAREJO_WEB_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres?options=-c%20role%3Dfarejo_web` no terminal e execute `pnpm --filter @farejo/web dev --port 32150`. Execute as três etapas de dados **antes** de abrir o catálogo. Se os dados mudarem depois, invalide a tag `catalog` pela rota interna assinada; apenas reiniciar o servidor não elimina necessariamente o cache persistido do Next.js.

Em 23/09/2026, essa prévia tinha 657 lojas, 1.010 ofertas e 35 lojas com 70 associações de categoria. Os números variam com as coletas e não representam a cobertura final do projeto. A pesquisa individual do inventário e a aprovação do manifesto de produção ainda são necessárias antes de publicar o filtro com categorias reais.
