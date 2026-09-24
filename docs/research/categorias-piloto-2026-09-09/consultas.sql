-- Piloto de categorias: consultas somente de leitura.
-- Executadas em 10/09/2026 UTC (09/09 BRT). Resultados mudam com novas coletas/curadoria.
-- Não consultar dados de assinantes. A view pública governa a elegibilidade.

select s.id, s.slug, s.name, coalesce(c.platform_count, 0)::int as eligible_platform_count
from public.stores s
left join web_read.catalog_stores c on c.slug = s.slug
order by s.slug;

-- Amostra intencional escolhida a partir do inventário acima:
select s.id, s.slug, s.name,
       coalesce(c.platform_count, 0)::int as eligible_platform_count,
       (select jsonb_agg(jsonb_build_object('platform_id', a.platform_id, 'name', a.raw_name)
                         order by a.platform_id)
        from public.store_aliases a where a.store_id = s.id) as aliases,
       (select jsonb_agg(jsonb_build_object('platform_id', o.platform_id, 'url', o.url)
                         order by o.platform_id)
        from public.offers o where o.store_id = s.id) as platform_links
from public.stores s
left join web_read.catalog_stores c on c.slug = s.slug
where s.slug in (
  'mercadolivre',
  'magazineluiza',
  'aliexpress',
  'shopee',
  'carrefour',
  'swift',
  'baggiocafe',
  'casaspedro',
  'evino',
  'tiasonia',
  'adidas',
  'renner',
  '24s',
  'lolacosmetics',
  'natura',
  'paguemenos',
  'cpaps',
  'kabum',
  'dell',
  'pichau',
  '4seating',
  'madesa',
  'leroymerlin',
  'brinoxshop',
  'decathlon',
  'growthsupplements',
  'cobasi',
  'petlove',
  'zeedog',
  'booking',
  'buser',
  'airalo',
  'allianztravel',
  'alura',
  'udemy',
  'leiturinha',
  'livrariamartinsfontespaulista',
  'hostinger',
  '1password',
  'nottaai',
  'disneyplus',
  'nuuvem',
  'pneustore',
  'semparar',
  'giulianaflores',
  'parafuzo',
  'remessaonline',
  'timcontrole',
  'bobbarsoverbottles',
  'testeops'
)
order by s.slug;

