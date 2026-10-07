import { spawnSync } from 'node:child_process';
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Local state operations only. Remote migration is a separate, approved bootstrap step.
const foundation = resolve('infra/gcp/terraform.tfstate');
const runtime = resolve('infra/gcp/runtime/terraform.tfstate');
const source = JSON.parse(readFileSync(foundation, 'utf8'));
const addresses = ['google_cloud_run_v2_job', 'google_cloud_scheduler_job'];
assert(!existsSync(runtime), 'Runtime state already exists; refusing a second split');
for (const type of addresses) assert(source.resources.some(r => r.type === type && r.name === 'scraper'));
const backup = resolve('.local/state-backups/' + Date.now());
mkdirSync(backup, { recursive: true });
copyFileSync(foundation, backup + '/foundation.tfstate');
const tool = process.env.TERRAFORM_BINARY ?? 'terraform';
for (const type of addresses) {
  const result = spawnSync(tool, ['-chdir=infra/gcp', 'state', 'mv', '-state=terraform.tfstate', '-state-out=runtime/terraform.tfstate', `${type}.scraper[0]`, `${type}.scraper`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('State move failed; recover from the private backup before continuing');
}
const administrative = JSON.parse(readFileSync(foundation, 'utf8'));
const operational = JSON.parse(readFileSync(runtime, 'utf8'));
assert.equal(administrative.lineage, source.lineage);
assert.notEqual(operational.lineage, administrative.lineage);
assert.equal(operational.resources.length, 2);
assert.equal(administrative.resources.length + operational.resources.length, source.resources.length);
console.log('Local state split verified: all resources retained, administrative lineage preserved, independent runtime lineage.');
