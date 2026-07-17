# Versões estáveis mais recentes compatíveis com a Vercel

## Contexto

A Fase 3 cria o primeiro app Next.js do monorepo. “Versão mais nova possível” precisa significar
versão estável, suportada no runtime de produção e com correções de segurança, não preview,
release candidate ou canary. Usar uma linha Current do Node que a Vercel ainda não oferece também
criaria diferença entre desenvolvimento, CI e produção.

## Decisão

O monorepo usa a linha mais recente do Node.js que seja simultaneamente LTS e suportada pela
Vercel. Na data desta decisão (14/07/2026), isso significa Node.js `24.x`. A Vercel ainda não
oferece Node.js 26 e o próprio projeto Node o classifica como Current, não LTS. Scraper, testes,
desenvolvimento local e web permanecem na mesma major para evitar dois runtimes no monorepo.

O web nasce com o `next@latest` estável disponível no momento da implementação. Na data desta
decisão, a referência é Next.js `16.2.10`, React `19.2.7` e React DOM `19.2.7`. Next.js 16.3 está em
preview/canary e não entra em produção até ganhar release estável.

A major de Node fica declarada como `24.x` no root do monorepo e configurada igualmente na Vercel;
minor e patch acompanham automaticamente a linha oferecida pela plataforma. Dependências ficam
resolvidas no lockfile, sem usar tags flutuantes em builds reproduzíveis.

Antes de iniciar a implementação e novamente antes da publicação, o time confere `node@LTS`,
`next@latest`, React, compatibilidade da Vercel e advisories de segurança. Depois do lançamento,
patches e minors estáveis entram por atualização frequente; mudanças de major exigem validação
explícita de build, testes e handoff visual.

## Consequências

- “Mais novo” não autoriza `canary`, `preview`, `beta` ou `rc` em produção.
- Node.js 26 só substitui 24 quando estiver em uma linha apropriada para produção e disponível na
  Vercel; não antecipamos essa troca apenas no scraper.
- O app usa App Router, Cache Components e APIs estáveis da versão escolhida.
- O número de patch registrado aqui é um retrato da decisão; a regra permanente é resolver a
  versão estável mais recente no início da implementação e manter o lockfile atualizado.
