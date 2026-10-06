import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

function command(tool, args, capture = false) {
  const result = spawnSync(tool, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`${tool} failed (${result.status})`);
  return result.stdout;
}

const image = process.argv[2];
if (!image || !/^[a-zA-Z0-9./:@_-]+$/.test(image)) throw new Error('Expected a local image tag');
const stack = resolve('.local/gcp-fixtures');
mkdirSync(stack + '/supabase', { recursive: true });
let config = readFileSync('supabase/config.toml', 'utf8');
config = config.replace('project_id = "farejo"', 'project_id = "farejo-gcp-fixtures"').replace(/\b553(\d{2})\b/g, '557$1');
assert(config.includes('project_id = "farejo-gcp-fixtures"') && config.includes('port = 55721'));
writeFileSync(stack + '/supabase/config.toml', config);
cpSync('supabase/migrations', stack + '/supabase/migrations', { recursive: true });
const output = resolve('.local/container-test-output');
mkdirSync(output, { recursive: true });
chmodSync(output, 0o777);
writeFileSync(output + '/invalidation.jsonl', '');

try {
  command('supabase', ['start', '--workdir', stack], true);
  // This project and port belong exclusively to this test; never reset the developer's stack.
  command('supabase', ['db', 'reset', '--local', '--workdir', stack], true);
  const status = JSON.parse(command('supabase', ['status', '--workdir', stack, '-o', 'json'], true));
  const api = new URL(status.API_URL);
  assert.equal(api.hostname, '127.0.0.1');
  assert.equal(api.port, '55721');
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string');
  const headers = { apikey: status.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + status.SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  async function request(path, options = {}) {
    const response = await fetch(api.origin + '/rest/v1/' + path, { headers, ...options });
    assert(response.ok, `Local database request failed: ${path} (${response.status})`);
    return response.status === 204 || response.headers.get('content-length') === '0' ? null : response.json();
  }
  await request('crawl_state', { method: 'POST', body: JSON.stringify([
    { platform_id: 'cuponomia', slug: 'iplace', tier: 'active' },
    { platform_id: 'meliuz', slug: 'cupom-magazine-luiza', tier: 'active' },
  ]) });
  const containerApi = process.platform === 'win32' ? 'http://host.docker.internal:55721' : api.origin;
  command('docker', ['run', '--rm', '--network', 'host',
    '--mount', `type=bind,source=${resolve('scripts/gcp')},target=/test,readonly`,
    '--mount', `type=bind,source=${output},target=/test-output`,
    '-e', 'SUPABASE_URL=' + containerApi,
    '-e', 'SUPABASE_SERVICE_ROLE_KEY=' + status.SERVICE_ROLE_KEY,
    '-e', 'CATALOG_INVALIDATION_URL=https://invalidation.farejo.test/api',
    '-e', 'CATALOG_INVALIDATION_SECRET=local-fixture-hmac-key-at-least-32-characters',
    '-e', 'SCRAPE_PLATFORM=all', '-e', 'SCRAPE_TIER=active', '-e', 'SCRAPE_RUNNER=cloud-run',
    '-e', 'NODE_OPTIONS=--import=/test/fixture-fetch.mjs', image]);
  const runs = await request('scrape_runs?select=platform_id,status,scope,active_offers,notes');
  assert.equal(runs.length, 5);
  for (const run of runs) {
    assert.equal(run.status, 'ok');
    assert(run.active_offers > 0);
    assert.equal(JSON.parse(run.notes).execution_source, 'cloud-run');
    assert.equal(run.scope, ['cuponomia', 'meliuz'].includes(run.platform_id) ? 'active' : 'full');
  }
  assert.deepEqual(runs.map(r => r.platform_id).sort(), ['cuponomia', 'inter', 'meliuz', 'mycashback', 'zoom']);
  const invalidations = readFileSync(output + '/invalidation.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(invalidations.length, 5);
  for (const run of runs) assert(invalidations.some(event => event.platform_id === run.platform_id));
  console.log('Container integration passed: five real parsers, local writes, scopes, execution source and HMAC invalidation.');
} finally {
  command('supabase', ['stop', '--workdir', stack]);
}
