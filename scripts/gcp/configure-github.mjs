import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { repository, project } from './release-policy.mjs';

// Repository configuration only. Input contains Terraform output identifiers, never credentials.
const values = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const expected = [
  'GCP_PROJECT_ID', 'GCP_REGION', 'GCP_TF_STATE_BUCKET', 'GCP_RELEASE_BUCKET',
  'GCP_PUBLISHER_WIF_PROVIDER', 'GCP_PLANNER_WIF_PROVIDER', 'GCP_DEPLOYER_WIF_PROVIDER',
  'GCP_PUBLISHER_SERVICE_ACCOUNT', 'GCP_PLANNER_SERVICE_ACCOUNT', 'GCP_DEPLOYER_SERVICE_ACCOUNT',
];
assert.deepEqual(Object.keys(values).sort(), expected.sort());
assert.equal(values.GCP_PROJECT_ID, project);
for (const [name, value] of Object.entries(values)) {
  assert.equal(typeof value, 'string');
  assert(!value.includes('\n'));
  const result = spawnSync('gh', ['variable', 'set', name, '--repo', repository, '--body', value], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Failed to configure variable ${name}`);
}
console.log('Ten non-secret GitHub Actions variables configured.');
