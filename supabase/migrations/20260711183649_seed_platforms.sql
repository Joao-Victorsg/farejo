-- Seed idempotente das 5 plataformas (AC: migration, não seed.sql — existe também no projeto hospedado).
insert into platforms (id, name, base_url) values
  ('meliuz',     'Méliuz',         'https://www.meliuz.com.br'),
  ('cuponomia',  'Cuponomia',      'https://www.cuponomia.com.br'),
  ('mycashback', 'MyCashback',     'https://www.mycashback.com.br'),
  ('zoom',       'Zoom',           'https://www.zoom.com.br'),
  ('inter',      'Shopping Inter', 'https://shopping.inter.co')
on conflict (id) do nothing;
