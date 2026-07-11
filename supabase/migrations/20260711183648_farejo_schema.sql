-- Schema da Fase 1 (docs/farejo-system-design.md §3; ADR-0003 — platforms, não sites).
-- crawl_state e pg_trgm ficam para as Fases 2/3.

create table platforms (
  id          text primary key,
  name        text not null,
  base_url    text not null
);

create table stores (
  id          bigint generated always as identity primary key,
  slug        text unique not null,
  name        text not null,
  logo_url    text,
  logo_hash   text,
  created_at  timestamptz default now()
);

create table store_aliases (
  platform_id text references platforms(id),
  raw_name    text not null,
  store_id    bigint references stores(id),
  confidence  text not null default 'auto',
  primary key (platform_id, raw_name)
);

create table offers (
  store_id      bigint references stores(id),
  platform_id   text references platforms(id),
  reward_type   text not null,
  value         numeric(10,2) not null,
  value_partial numeric(10,2),
  is_upto       boolean default false,
  raw_text      text not null,
  url           text not null,
  active        boolean default true,
  last_seen_at  timestamptz not null,
  updated_at    timestamptz default now(),
  primary key (store_id, platform_id)
);

create table offer_history (
  id          bigint generated always as identity primary key,
  store_id    bigint not null,
  platform_id text references platforms(id),
  reward_type text not null,
  value       numeric(10,2),
  is_upto     boolean default false,
  changed_at  timestamptz not null default now(),
  foreign key (store_id, platform_id) references offers(store_id, platform_id)
);

create index idx_history_store on offer_history (store_id, platform_id, changed_at desc);

create table scrape_runs (
  id            bigint generated always as identity primary key,
  platform_id   text references platforms(id),
  started_at    timestamptz not null,
  finished_at   timestamptz,
  status        text not null,
  offers_found  int,
  active_offers int,
  parse_errors  int,
  soft_blocks   int default 0,
  notes         text
);

create index idx_offers_active on offers (active, value desc);

-- RLS ligado em todas as tabelas por padrão defensivo (repo público); sem policies ainda —
-- service_role ignora RLS (scraper), anon/authenticated ficam sem acesso até a Fase 3 definir policies.
alter table platforms enable row level security;
alter table stores enable row level security;
alter table store_aliases enable row level security;
alter table offers enable row level security;
alter table offer_history enable row level security;
alter table scrape_runs enable row level security;

-- auto_expose_new_tables é false por padrão (ver supabase/config.toml): sem GRANT explícito
-- nenhuma role, nem service_role, enxerga a tabela via PostgREST.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
