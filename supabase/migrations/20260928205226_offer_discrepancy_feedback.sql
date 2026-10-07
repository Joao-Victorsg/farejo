-- Sinal privado por versão sem identidade do visitante. A função valida a oferta corrente.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_feedback_owner') then
    create role farejo_feedback_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'farejo_feedback') then
    create role farejo_feedback login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_feedback_owner, farejo_feedback to postgres;
alter role farejo_feedback set statement_timeout = '1500ms';
alter role farejo_feedback set lock_timeout = '1500ms';
alter role farejo_feedback set search_path = feedback, pg_catalog;

create schema feedback authorization farejo_feedback_owner;
set role farejo_feedback_owner;
revoke all on schema feedback from public, anon, authenticated, farejo_web;
grant usage on schema feedback to farejo_feedback;
alter default privileges for role farejo_feedback_owner in schema feedback revoke execute on functions from public;
set role postgres;

grant usage on schema public to farejo_feedback_owner;
grant select (id, slug) on public.stores to farejo_feedback_owner;
grant select (store_id, platform_id, reward_type, value, value_partial, is_upto, active, last_seen_at) on public.offers to farejo_feedback_owner;
grant select (id, store_id, platform_id) on public.offer_history to farejo_feedback_owner;
create policy feedback_owner_select_stores on public.stores for select to farejo_feedback_owner using (true);
create policy feedback_owner_select_offers on public.offers for select to farejo_feedback_owner using (true);
create policy feedback_owner_select_offer_history on public.offer_history for select to farejo_feedback_owner using (true);

set role farejo_feedback_owner;

create table feedback.offer_discrepancies (
  id bigint generated always as identity primary key,
  store_id bigint not null,
  store_slug text not null,
  platform_id text not null,
  offer_version bigint not null,
  reward_type text not null,
  value numeric(10,2) not null,
  value_partial numeric(10,2),
  is_upto boolean not null,
  reported_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'verified', 'dismissed')),
  unique (store_id, platform_id, offer_version)
);
alter table feedback.offer_discrepancies enable row level security;
revoke all on table feedback.offer_discrepancies from public, anon, authenticated, farejo_web, farejo_feedback;

create function feedback.report_offer_discrepancy(requested_store_slug text, requested_platform_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_offer record;
begin
  if requested_store_slug !~ '^[a-z0-9-]{1,100}$'
     or requested_platform_id !~ '^[a-z0-9-]{1,40}$' then
    return false;
  end if;

  select stores.id as store_id, stores.slug as store_slug,
         offers.platform_id, offers.reward_type, offers.value, offers.value_partial,
         coalesce(offers.is_upto, false) as is_upto,
         coalesce((select max(history.id) from public.offer_history history
                   where history.store_id = offers.store_id and history.platform_id = offers.platform_id), 0) as offer_version
    into current_offer
    from public.stores stores
    join public.offers offers on offers.store_id = stores.id
   where stores.slug = requested_store_slug
     and offers.platform_id = requested_platform_id
     and offers.active = true
     and offers.last_seen_at >= now() - interval '48 hours';

  if not found then return false; end if;

  insert into feedback.offer_discrepancies
    (store_id, store_slug, platform_id, offer_version, reward_type, value, value_partial, is_upto)
  values
    (current_offer.store_id, current_offer.store_slug, current_offer.platform_id,
     current_offer.offer_version, current_offer.reward_type, current_offer.value,
     current_offer.value_partial, current_offer.is_upto)
  on conflict (store_id, platform_id, offer_version) do nothing;
  return true;
end;
$$;

revoke all on function feedback.report_offer_discrepancy(text, text) from public, anon, authenticated, farejo_web;
grant execute on function feedback.report_offer_discrepancy(text, text) to farejo_feedback;

set role postgres;
