import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imagePrefix, validateCandidate, relevantPaths, validateUpstream, validateManifest, validatePlan, successfullyPublished, releasePins, replacementDenied } from './release-policy.mjs';

const candidate = { sha: 'a'.repeat(40), prepareRunId: '123', ciRunId: '122', image: imagePrefix + '@sha256:' + 'b'.repeat(64), containerTest: 'passed' };
test('retention pins use distinct immutable names for each approval', () => {
  assert.deepEqual(releasePins('123'), { current: imagePrefix + ':protected-current-123', previous: imagePrefix + ':protected-previous-123' });
  assert.notEqual(releasePins('124').current, releasePins('123').current);
  assert.throws(() => releasePins('../123'));
});
test('replacement probes accept explicit authorization or immutable-tag denial only', () => {
  assert(replacementDenied({ status: 1, stderr: 'denied: artifactregistry.tags.update' }));
  assert(replacementDenied({ status: 1, stderr: 'Repository has enabled tag immutability' }));
  assert(!replacementDenied({ status: 0, stderr: 'immutable' }));
  assert(!replacementDenied({ status: 1, stderr: 'network timeout' }));
});
test('candidate requires the tested digest in the Farejo registry', () => {
  assert.equal(validateCandidate(candidate), candidate);
  for (const delta of [{ image: imagePrefix + ':latest' }, { image: 'evil.example/scraper@sha256:' + 'b'.repeat(64) }, { containerTest: 'skipped' }, { sha: 'master' }]) {
    assert.throws(() => validateCandidate({ ...candidate, ...delta }));
  }
});
test('changes are compared with the last deployed release and include transitive inputs', () => {
  assert(relevantPaths(['packages/shared/src/index.ts']));
  assert(relevantPaths(['supabase/migrations/20261006000000.sql']));
  assert(relevantPaths(['.github/workflows/gcp-deploy.yml']));
  assert(!relevantPaths(['apps/web/src/app/page.tsx', 'docs/design.md']));
});
test('an all-skipped successful workflow never advances the deployed baseline', () => {
  const run = { conclusion: 'success', event: 'workflow_dispatch', head_branch: 'master', head_repository: { id: 1297090348 } };
  const job = { name: 'deploy', conclusion: 'success', steps: [{ name: 'Apply the approved plan and verify configuration', conclusion: 'success' }] };
  assert(successfullyPublished(run, [job]));
  assert(!successfullyPublished(run, [{ ...job, conclusion: 'skipped' }]));
  assert(!successfullyPublished(run, [{ ...job, steps: [] }]));
  assert(!successfullyPublished(run, [{ ...job, steps: [{ ...job.steps[0], conclusion: 'skipped' }] }]));
  assert(!successfullyPublished({ ...run, head_branch: 'feature' }, [job]));
});
test('forks, failing CI and non-master source runs are rejected', () => {
  const run = { name: 'CI', path: '.github/workflows/ci.yml', conclusion: 'success', head_branch: 'master', head_repository: { id: 1297090348 }, head_sha: candidate.sha };
  assert.equal(validateUpstream(run, 'CI'), candidate.sha);
  for (const delta of [{ path: '.github/workflows/fake-ci.yml' }, { head_repository: { id: 7 } }, { head_branch: 'feature' }, { conclusion: 'failure' }, { name: 'Other' }]) {
    assert.throws(() => validateUpstream({ ...run, ...delta }, 'CI'));
  }
});
test('saved releases expire and require an object generation and hash', () => {
  const release = { ...candidate, releaseId: '456', planHash: 'c'.repeat(64), planFingerprint: 'd'.repeat(64), planGeneration: '789', createdAt: new Date(100000000).toISOString() };
  assert.equal(validateManifest(release, 100000001), release);
  assert.throws(() => validateManifest(release, 200000000));
  assert.throws(() => validateManifest({ ...release, planGeneration: undefined }, 100000001));
});
test('an empty or extra-resource plan never authorizes production', () => {
  assert.throws(() => validatePlan({}, candidate, '456'));
  assert.throws(() => validatePlan({ planned_values: { root_module: { resources: [{ address: 'google_project_iam_member.admin' }] } } }, candidate, '456'));
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/runtime-plan.json', import.meta.url), 'utf8'));
test('actual Google provider plan satisfies the operational contract', () => {
  assert.deepEqual(validatePlan(fixture.plan, fixture.candidate, '0'), [{ address: 'google_cloud_run_v2_job.scraper', actions: ['update'] }]);
});
test('runtime privilege expansion, plaintext secrets and destructive actions are rejected', () => {
  const mutations = [
    p => { p.planned_values.root_module.resources[0].values.template[0].template[0].service_account = 'admin@farejo-510021.iam.gserviceaccount.com'; },
    p => { p.planned_values.root_module.resources[0].values.template[0].template[0].containers[0].env.push({ name: 'NODE_OPTIONS', value: 'malicious' }); },
    p => { const e = p.planned_values.root_module.resources[0].values.template[0].template[0].containers[0].env.find(e => e.name === 'SUPABASE_SERVICE_ROLE_KEY'); e.value = 'plaintext'; },
    p => { p.resource_changes[0].change.actions = ['delete', 'create']; },
    p => { p.planned_values.root_module.resources[1].values.schedule = '* * * * *'; },
    p => { p.planned_values.root_module.resources[0].values.template[0].template[0].volumes = [{ name: 'unexpected' }]; },
    p => { p.planned_values.root_module.resources[0].values.template[0].template[0].vpc_access = [{ connector: 'unexpected' }]; },
    p => { p.resource_changes[1].change.actions = ['update']; },
    p => { p.planned_values.root_module.resources[0].values.start_execution_token = 'trigger'; },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(fixture.plan);
    mutate(plan);
    assert.throws(() => validatePlan(plan, fixture.candidate, '0'));
  }
});
