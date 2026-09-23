set role farejo_curation_owner;
create table curation.category_revisions (
  hash text primary key,
  manifest jsonb not null,
  applied_at timestamptz not null default now()
);
alter table curation.category_revisions enable row level security;

create function curation.category_state(p_slugs text[])
returns table (input_slug text, canonical_slug text, categories jsonb)
language sql stable security definer set search_path = pg_catalog, public
as $$
  select input.slug, s.slug, coalesce((
    select jsonb_agg(jsonb_build_object('slug', sc.category_slug, 'evidence', sc.evidence) order by sc.category_slug)
    from store_categories sc where sc.store_id = s.id
  ), '[]'::jsonb)
  from unnest(p_slugs) input(slug)
  left join store_slug_redirects redirects on redirects.from_slug = input.slug
  left join stores s on s.slug = input.slug or s.id = redirects.to_store_id;
$$;

create function curation.verify_category_manifest(p_manifest jsonb)
returns boolean language sql stable security definer set search_path = pg_catalog, public, curation
as $$
  select not exists (
    select 1 from jsonb_array_elements(p_manifest->'categories') item
    left join categories c on c.slug = item->>'slug'
    where c.slug is null or c.name is distinct from item->>'name'
      or c.icon is distinct from item->>'icon' or c.position is distinct from (item->>'position')::integer
      or c.active is distinct from (item->>'active')::boolean
  ) and not exists (
    select 1 from jsonb_array_elements(p_manifest->'stores') item
    cross join lateral curation.category_state(array[item->>'slug']) state
    where state.canonical_slug is null or state.categories is distinct from (
      select coalesce(jsonb_agg(value order by value->>'slug'), '[]'::jsonb)
      from jsonb_array_elements(item->'categories')
    )
  );
$$;

create function curation.apply_category_manifest(p_manifest jsonb)
returns table (applied boolean, revision_hash text)
language plpgsql security definer set search_path = pg_catalog, public, curation
as $$
declare
  v_hash text := md5(p_manifest::text);
  v_store jsonb;
  v_category jsonb;
  v_store_id bigint;
  v_store_ids bigint[] := array[]::bigint[];
begin
  perform pg_advisory_xact_lock(hashtextextended('farejo-curation', 0));
  if p_manifest->>'status' is distinct from 'approved' or p_manifest->>'version' is distinct from '1'
    or jsonb_typeof(p_manifest->'categories') is distinct from 'array'
    or jsonb_typeof(p_manifest->'stores') is distinct from 'array' then
    raise exception 'Manifest must be version 1 and approved, with categories and stores arrays';
  end if;
  if exists (select 1 from curation.category_revisions where hash = v_hash) then
    if not curation.verify_category_manifest(p_manifest) then
      raise exception 'Previously applied revision is stale; reconcile identity and categories before applying a new revision';
    end if;
    return query select false, v_hash;
    return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_manifest->'categories') item group by item->>'slug' having count(*) > 1) then
    raise exception 'Duplicate category';
  end if;

  for v_category in select * from jsonb_array_elements(p_manifest->'categories') loop
    if jsonb_typeof(v_category->'active') is distinct from 'boolean' then raise exception 'Category active must be boolean'; end if;
    insert into categories (slug, name, icon, position, active)
    values (v_category->>'slug', v_category->>'name', v_category->>'icon', (v_category->>'position')::integer, (v_category->>'active')::boolean)
    on conflict (slug) do update set name = excluded.name, icon = excluded.icon, position = excluded.position, active = excluded.active;
  end loop;

  for v_store in select * from jsonb_array_elements(p_manifest->'stores') loop
    select s.id into v_store_id
    from stores s left join store_slug_redirects r on r.to_store_id = s.id and r.from_slug = v_store->>'slug'
    where s.slug = v_store->>'slug' or r.from_slug is not null;
    if v_store_id is null then raise exception 'Unknown store: %', v_store->>'slug'; end if;
    if v_store_id = any(v_store_ids) then raise exception 'Multiple entries resolve to the same canonical store; reconcile the manifest'; end if;
    v_store_ids := v_store_ids || v_store_id;
    if jsonb_typeof(v_store->'categories') is distinct from 'array' then raise exception 'Store categories must be an explicit array'; end if;
    delete from store_categories where store_id = v_store_id;
    for v_category in select * from jsonb_array_elements(v_store->'categories') loop
      if jsonb_typeof(v_category->'evidence') is distinct from 'array' or jsonb_array_length(v_category->'evidence') = 0 then
        raise exception 'Category association requires evidence';
      end if;
      if exists (select 1 from jsonb_array_elements(v_category->'evidence') e
        where coalesce(e->>'url', '') !~ '^https?://' or coalesce(e->>'observedAt', '') !~ '^\d{4}-\d{2}-\d{2}$' or length(coalesce(e->>'note', '')) = 0) then
        raise exception 'Evidence requires public URL, observedAt and note';
      end if;
      insert into store_categories (store_id, category_slug, evidence)
      values (v_store_id, v_category->>'slug', v_category->'evidence');
    end loop;
  end loop;
  if not curation.verify_category_manifest(p_manifest) then raise exception 'Category verification failed'; end if;
  insert into curation.category_revisions (hash, manifest) values (v_hash, p_manifest);
  return query select true, v_hash;
end;
$$;
reset role;
revoke all on curation.category_revisions from public, anon, authenticated, farejo_web, farejo_curation;
revoke all on function curation.category_state(text[]), curation.verify_category_manifest(jsonb), curation.apply_category_manifest(jsonb) from public, anon, authenticated, farejo_web;
grant execute on function curation.category_state(text[]), curation.verify_category_manifest(jsonb), curation.apply_category_manifest(jsonb) to farejo_curation;
