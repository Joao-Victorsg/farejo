import { readFileSync, appendFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const fixtures = '/app/packages/test-fixtures/fixtures/';
const api = new URL(process.env.SUPABASE_URL);
if (!['127.0.0.1', 'host.docker.internal'].includes(api.hostname) || api.port !== '55721') {
  throw new Error('Container tests require the isolated local Supabase on port 55721');
}
const responses = new Map([
  ['https://marketplace-api.web.bancointer.com.br/site/affiliate/inter/v1/search/stores?lang=pt-BR&limit=400&offset=0', 'inter-stores.api.json'],
  ['https://www.zoom.com.br/cupom-de-desconto/lojas', 'zoom-lojas.html'],
  ['https://www.mycashback.com.br/all-shops', 'mycashback-all-shops.html'],
  ['https://www.cuponomia.com.br/desconto/iplace', 'cuponomia-loja-boost.html'],
  ['https://www.meliuz.com.br/desconto/cupom-magazine-luiza', 'meliuz-loja.html'],
]);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === api.origin) return originalFetch(input, options);
  const fixture = responses.get(url.href);
  if (fixture) return new Response(readFileSync(fixtures + fixture), { status: 200 });
  if (url.href === 'https://invalidation.farejo.test/api') {
    const body = options?.body;
    const headers = new Headers(options?.headers);
    if (typeof body !== 'string') throw new Error('Invalid invalidation body');
    const expected = createHmac('sha256', process.env.CATALOG_INVALIDATION_SECRET)
      .update(headers.get('x-farejo-timestamp') ?? '').update(body).digest('hex');
    if (headers.get('x-farejo-signature') !== expected) throw new Error('Invalid invalidation HMAC');
    appendFileSync('/test-output/invalidation.jsonl', body + '\n');
    return new Response('{}', { status: 200 });
  }
  throw new Error('Unexpected network request in fixture test: ' + url.origin + url.pathname);
};
