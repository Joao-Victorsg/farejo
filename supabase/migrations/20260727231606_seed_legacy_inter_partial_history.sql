-- ADR-0067: ofertas Inter legadas já tinham value_partial vigente, mas linhas anteriores à
-- ADR-0011 deixaram essa modalidade desconhecida. Esta baseline registra somente o estado
-- realmente observado em offers.last_seen_at; não reconstrói nenhum período anterior.
insert into public.offer_history (
  store_id,
  platform_id,
  reward_type,
  value,
  value_partial,
  is_upto,
  changed_at
)
select
  offer.store_id,
  offer.platform_id,
  offer.reward_type,
  offer.value,
  offer.value_partial,
  offer.is_upto,
  offer.last_seen_at
from public.offers as offer
where offer.platform_id = 'inter'
  and offer.active = true
  and offer.value_partial is not null
  and not exists (
    select 1
    from public.offer_history as history
    where history.store_id = offer.store_id
      and history.platform_id = offer.platform_id
      and history.value_partial is not null
  );
