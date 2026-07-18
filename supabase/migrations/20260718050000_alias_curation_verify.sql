-- F3/T13 (#59, ADR-0035 passo 4): verificação pós-apply de que o estado materializado
-- corresponde à decisão do manifesto. `curation.apply_alias_merge` já é atômica (uma
-- exceção desfaz tudo desde o início da chamada), então "materializado == manifesto" é
-- garantido POR CONSTRUÇÃO no instante em que a chamada retorna sucesso — esta função é
-- a checagem independente, chamada logo depois, exatamente como a ADR descreve como um
-- passo à parte (drift real só existiria se algo fora deste fluxo mexesse em store_aliases
-- depois, o que a função não tenta detectar — é uma checagem pontual pós-apply, não um
-- auditor contínuo).
create function curation.verify_alias_merge(
  p_canonical_slug text,
  p_aliases jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_canonical_id bigint;
  v_alias        jsonb;
  v_platform_id  text;
  v_raw_name     text;
  v_store_id     bigint;
begin
  select id into v_canonical_id from stores where slug = p_canonical_slug;
  if v_canonical_id is null then
    -- Mesma semântica de canonical_not_found em apply_alias_merge: nada para verificar
    -- ainda, não é uma discrepância.
    return true;
  end if;

  for v_alias in select * from jsonb_array_elements(p_aliases)
  loop
    v_platform_id := v_alias ->> 'platformId';
    v_raw_name    := v_alias ->> 'rawName';

    select store_id into v_store_id
      from store_aliases
      where platform_id = v_platform_id and raw_name = v_raw_name;

    if v_store_id is distinct from v_canonical_id then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

alter function curation.verify_alias_merge(text, jsonb) owner to farejo_curation_owner;
revoke all on function curation.verify_alias_merge(text, jsonb) from public, anon, authenticated, farejo_web;
grant execute on function curation.verify_alias_merge(text, jsonb) to farejo_curation;
