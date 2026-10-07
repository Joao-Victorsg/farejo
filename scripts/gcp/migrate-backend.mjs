import { spawnSync } from 'node:child_process';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

assert(process.argv.includes('--approved-bootstrap'), 'Run only after approving and applying the administrative plan');
const binary = process.env.TERRAFORM_BINARY ? resolve(process.env.TERRAFORM_BINARY) : 'terraform';
function run(args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.status, 0, 'Backend migration failed; preserve local backups and inspect backend state before retrying');
  return result.stdout;
}
assert.equal(JSON.parse(run(['version', '-json'])).terraform_version, '1.16.5');
const destination = resolve('.local/state-backups/remote-migration-' + Date.now());
mkdirSync(destination, { recursive: true });
for (const [directory, prefix] of [['infra/gcp', 'bootstrap'], ['infra/gcp/runtime', 'scraper-prod']]) {
  const source = JSON.parse(readFileSync(`${directory}/terraform.tfstate`, 'utf8'));
  copyFileSync(`${directory}/terraform.tfstate`, `${destination}/${prefix}.tfstate`);
  copyFileSync(`${directory}/backend.tf.example`, `${directory}/backend.tf`);
  run([`-chdir=${directory}`, 'init', '-input=false', '-migrate-state', '-force-copy', '-lockfile=readonly', '-backend-config=bucket=farejo-510021-tfstate', `-backend-config=prefix=${prefix}`]);
  const remote = JSON.parse(run([`-chdir=${directory}`, 'state', 'pull']));
  assert.equal(remote.lineage, source.lineage);
  assert.equal(remote.resources.length, source.resources.length);
}
console.log('Remote state migration verified: independent prefixes, original lineages, all resources retained.');
