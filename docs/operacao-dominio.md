# Domínio público do farejô

O endereço canônico é `https://www.farejo.site`. Configure `FAREJO_SITE_URL` com esse valor nos ambientes **Production** dos projetos Vercel `farejo` (web) e `farejo-bot` (respostas do bot). O valor padrão do web e `.env.example` também apontam para ele. Após mudar a variável, faça um novo deploy de cada projeto; alterar apenas a variável não atualiza um deploy já pronto.

No projeto web, mantenha `farejo.site` e `farejo.vercel.app` como aliases que redirecionam permanentemente para `www.farejo.site`. Teste um caminho com query string, por exemplo `/faq?utm_source=domain-smoke`, para confirmar que ambos são preservados. Não remova `www.farejo.site` do projeto.

O workflow de publicação confere a origem completa dos canonicals, do `robots.txt` e dos URLs do sitemap no deployment encenado. Após a promoção, repete o smoke somente-leitura no domínio público. Para uma conferência manual, verifique também:

- `https://www.farejo.site/` e um detalhe `/loja/<slug>` com canonical em `www.farejo.site`;
- `https://www.farejo.site/robots.txt` com `Sitemap: https://www.farejo.site/sitemap.xml`;
- todos os `<loc>` de `https://www.farejo.site/sitemap.xml` na mesma origem;
- links emitidos pelo bot para lojas e páginas do site.

Depois de publicar o sitemap correto, envie `https://www.farejo.site/sitemap.xml` na propriedade `farejo.site` do Google Search Console e confira o status de leitura. O envio exige uma conta com acesso à propriedade.
