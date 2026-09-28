# Avisos de valor divergente

A interface para enviar avisos está suspensa enquanto decidimos onde colocá-la na experiência da página. O servidor está preparado: `POST /api/offer-discrepancy` recebe apenas `storeSlug` e `platformId`. A função `feedback.report_offer_discrepancy` revalida a oferta ativa e observada nas últimas 48 horas, captura tipo, valores e versão (último evento de `offer_history`) e mantém uma linha por oferta e versão. Envios novos e repetidos recebem a mesma resposta `202`. O registro não contém IP, cookie, texto livre nem identificador do visitante.

## Acesso e revisão

- `FAREJO_FEEDBACK_DATABASE_URL` existe somente no projeto web, em Production, e usa a role `farejo_feedback`. Ela pode executar a função, mas não ler ou alterar a tabela diretamente.
- `farejo_web`, `anon` e `authenticated` não têm acesso ao schema privado `feedback` nem à função. O proprietário `farejo_feedback_owner` é uma role sem login, usada para revisão no SQL Editor por um operador autorizado.
- Um aviso é um sinal para conferir a oferta no site da plataforma. A revisão manual muda `status` para `verified` ou `dismissed`; não altera `offers`.

```sql
set role farejo_feedback_owner;
select id, store_slug, platform_id, reward_type, value, value_partial,
       is_upto, offer_version, reported_at, status
from feedback.offer_discrepancies
where status = 'pending'
order by reported_at asc;
set role postgres;
```

Após conferir uma linha, o operador pode usar `update feedback.offer_discrepancies set status = 'verified' where id = ...` (ou `dismissed`) sob a mesma role. A chave única continua a aceitar no máximo uma linha por versão.

## Limite e publicação

A regra WAF de Production limita `POST /api/offer-discrepancy` a 10 requisições por minuto por IP. Publicar primeiro com ação de log, observar as correspondências e só então mudar para bloqueio. Conferir `429` na rota depois da ativação e verificar que outras rotas não são afetadas. A Vercel pode registrar dados de requisição para aplicar a regra; o banco do farejô não grava o IP no aviso.
