# A entidade de cashback chama-se "Plataforma", não "site" nem "portal"

A entidade que agrega Méliuz, Cuponomia, MyCashback, Zoom e Inter é **Plataforma**: tabela `platforms`, FK `platform_id`, tipo `Platform`/`PlatformAdapter`, label e rota `/plataformas` na UI. Escolhemos "plataforma" porque o handoff (fonte da verdade visual) e a rota já usam esse termo, e alinhar código ↔ schema ↔ UI num único termo é o ponto da linguagem ubíqua. Identificadores em inglês (`platforms`, `platform_id`), consistente com `stores`/`offers`/`store_aliases`.

## Consequências

- **"site" fica reservado para *site alvo*** — a propriedade web que um adapter raspa (seu HTML, anti-bot, "total declarado pelo site"). É um sentido distinto da entidade; por isso a skill de adapter ainda fala "o HTML servido pelo site mente".
- **Docs históricos divergem de propósito.** `CLAUDE.md`, `poc/` e `farejo-recon-e-plano.md` foram escritos antes desta decisão e usam `sites`/`site_id` — não foram reescritos (são log/histórico). O schema autoritativo (`docs/farejo-system-design.md` §3), o `CONTEXT.md` e o contrato do adapter usam `platforms`/`platform_id`. Código novo segue o schema.
- Feito **pré-código** (só POC + docs existiam): o custo foi editar docs, não migrar código + dados.
