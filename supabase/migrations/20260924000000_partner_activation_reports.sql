-- F3: separar os redirects sintéticos do smoke de publicação dos encaminhamentos do público.

create table public.activation_smoke_metrics (
  day date not null default current_date,
  activations integer not null default 0 check (activations >= 0),
  primary key (day)
);
alter table public.activation_smoke_metrics enable row level security;
revoke all on table public.activation_smoke_metrics from public, anon, authenticated, farejo_web, farejo_activation;
grant select, insert, update on table public.activation_smoke_metrics to farejo_metrics;
grant select, insert, update on table public.activation_smoke_metrics to farejo_metrics_owner;
create policy metrics_owner_write_smoke_aggregate on public.activation_smoke_metrics
  for all to farejo_metrics_owner using (true) with check (true);
create policy metrics_role_read_smoke_aggregate on public.activation_smoke_metrics
  for select to farejo_metrics using (true);
create policy metrics_role_insert_smoke_aggregate on public.activation_smoke_metrics
  for insert to farejo_metrics with check (true);
create policy metrics_role_update_smoke_aggregate on public.activation_smoke_metrics
  for update to farejo_metrics using (true) with check (true);

create table public.activation_metrics_cutover (
  singleton boolean primary key default true check (singleton),
  clean_from date not null
);
-- Daily aggregates cannot distinguish traffic before and after this migration on the same day.
-- Start the clean window tomorrow so today's existing counter remains historical in full.
insert into public.activation_metrics_cutover (singleton, clean_from) values (true, current_date + 1);
alter table public.activation_metrics_cutover enable row level security;
revoke all on table public.activation_metrics_cutover from public, anon, authenticated, farejo_web, farejo_activation;
grant select on table public.activation_metrics_cutover to farejo_metrics;
grant select on table public.activation_metrics_cutover to farejo_metrics_owner;
create policy metrics_role_read_cutover on public.activation_metrics_cutover
  for select to farejo_metrics using (true);
create policy metrics_owner_read_cutover on public.activation_metrics_cutover
  for select to farejo_metrics_owner using (true);

create function activation.record_activation(
  requested_store_id bigint,
  requested_platform_id text,
  requested_source text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if requested_source = 'production_smoke' then
    insert into public.activation_smoke_metrics (day, activations)
    values (current_date, 1)
    on conflict (day)
    do update set activations = public.activation_smoke_metrics.activations + 1;
  elsif requested_source = 'user' then
    insert into public.activation_metrics (day, store_id, platform_id, activations)
    values (current_date, requested_store_id, requested_platform_id, 1)
    on conflict (day, store_id, platform_id)
    do update set activations = public.activation_metrics.activations + 1;
  else
    raise exception 'activation.record_activation: unsupported source';
  end if;
end;
$$;
alter function activation.record_activation(bigint, text, text) owner to farejo_metrics_owner;
revoke all on function activation.record_activation(bigint, text, text) from public, anon, authenticated, farejo_web, farejo_activation;
grant execute on function activation.record_activation(bigint, text, text) to farejo_metrics;

-- Keep the old signature during rolling deployments; old app instances record public redirects.
create or replace function activation.record_activation(requested_store_id bigint, requested_platform_id text)
returns void
language sql
security invoker
set search_path = pg_catalog, activation
as $$
  select activation.record_activation(requested_store_id, requested_platform_id, 'user');
$$;
alter function activation.record_activation(bigint, text) owner to farejo_metrics_owner;
revoke all on function activation.record_activation(bigint, text) from public, anon, authenticated, farejo_web, farejo_activation;
grant execute on function activation.record_activation(bigint, text) to farejo_metrics;
