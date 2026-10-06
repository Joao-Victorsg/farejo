import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const project = 'farejo-510021';
export const region = 'southamerica-east1';
export const repository = 'Joao-Victorsg/farejo';
export const imagePrefix = `${region}-docker.pkg.dev/${project}/farejo-scraper/scraper`;
export const secretNames = {
  SUPABASE_URL: 'farejo-scraper-supabase-url',
  SUPABASE_SERVICE_ROLE_KEY: 'farejo-scraper-supabase-service-role-key',
  CATALOG_INVALIDATION_URL: 'farejo-scraper-catalog-invalidation-url',
  CATALOG_INVALIDATION_SECRET: 'farejo-scraper-catalog-invalidation-secret',
};

export function validateCandidate(value) {
  assert(value && typeof value === 'object', 'Missing candidate');
  assert.match(value.sha, /^[a-f0-9]{40}$/);
  assert.match(value.prepareRunId, /^\d+$/);
  assert.match(value.ciRunId, /^\d+$/);
  assert.equal(value.image?.slice(0, imagePrefix.length + 8), imagePrefix + '@sha256:');
  assert.match(value.image.slice(imagePrefix.length + 8), /^[a-f0-9]{64}$/);
  assert.equal(value.containerTest, 'passed');
  return value;
}

export function validateUpstream(run, name) {
  assert.equal(run.name, name);
  assert.equal(run.conclusion, 'success');
  assert.equal(run.head_branch, 'master');
  assert.equal(run.head_repository?.id, 1297090348);
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  return run.head_sha;
}

export function relevantPaths(paths) {
  return paths.some(p => /^(apps\/scraper\/|packages\/(shared|postgres|test-fixtures)\/|infra\/gcp\/|scripts\/gcp\/|supabase\/migrations\/|\.github\/workflows\/(ci|gcp-[\w-]+)\.yml$)/.test(p)
    || ['Dockerfile', '.dockerignore', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'].includes(p));
}

export function successfullyPublished(run, jobs) {
  return run.conclusion === 'success' && run.event === 'workflow_dispatch'
    && run.head_branch === 'master' && run.head_repository?.id === 1297090348
    && jobs.some(job => job.name === 'deploy' && job.conclusion === 'success'
      && job.steps?.some(step => step.name === 'Apply the approved plan and verify configuration' && step.conclusion === 'success'));
}

function jobContract(value, candidate, releaseId) {
  assert.equal(value.project, project);
  assert.equal(value.location, region);
  assert.equal(value.name, 'farejo-scraper');
  assert.equal(value.deletion_protection, true);
  assert.equal(value.labels.source_sha, candidate.sha);
  assert.equal(value.labels.release_id, releaseId);
  assert.equal(value.template.length, 1);
  const tasks = value.template[0];
  assert.equal(tasks.task_count, 1);
  assert.equal(tasks.parallelism, 1);
  assert.equal(tasks.template.length, 1);
  const task = tasks.template[0];
  assert.equal(task.service_account, `farejo-scraper-runner@${project}.iam.gserviceaccount.com`);
  assert.equal(task.max_retries, 0);
  assert.equal(task.timeout, '5400s');
  assert.equal(task.containers.length, 1);
  const container = task.containers[0];
  assert.equal(container.image, candidate.image);
  assert.equal(container.command?.length ?? 0, 0);
  assert.equal(container.args?.length ?? 0, 0);
  assert.equal(container.resources[0].limits.cpu, '1');
  assert.equal(container.resources[0].limits.memory, '2Gi');
  assert.equal(container.env.length, 7);
  const env = Object.fromEntries(container.env.map(e => [e.name, e]));
  assert.equal(Object.keys(env).length, 7);
  for (const [name, expected] of Object.entries({ SCRAPE_PLATFORM: 'all', SCRAPE_TIER: 'active', SCRAPE_RUNNER: 'cloud-run' })) {
    assert.equal(env[name].value, expected);
    assert.equal(env[name].value_source?.length ?? 0, 0);
  }
  for (const [name, secret] of Object.entries(secretNames)) {
    assert(!env[name].value, 'Production credentials must be Secret Manager references');
    assert.equal(env[name].value_source[0].secret_key_ref[0].secret, secret);
    assert.equal(env[name].value_source[0].secret_key_ref[0].version, '1');
  }
}

function schedulerContract(value) {
  assert.equal(value.project, project);
  assert.equal(value.region, region);
  assert.equal(value.name, 'farejo-scrape-0900-brt');
  assert.equal(value.schedule, '0 9 * * *');
  assert.equal(value.time_zone, 'America/Sao_Paulo');
  assert.equal(value.attempt_deadline, '320s');
  assert.equal(value.paused, false);
  assert.equal(value.retry_config[0].retry_count, 0);
  const target = value.http_target[0];
  assert.equal(target.http_method, 'POST');
  assert.equal(target.uri, `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/farejo-scraper:run`);
  assert.equal(target.oauth_token[0].service_account_email, `farejo-scraper-scheduler@${project}.iam.gserviceaccount.com`);
  assert.equal(target.oauth_token[0].scope, 'https://www.googleapis.com/auth/cloud-platform');
}

export function validatePlan(plan, candidate, releaseId) {
  validateCandidate(candidate);
  assert.match(releaseId, /^\d+$/);
  const resources = plan.planned_values?.root_module?.resources;
  assert(Array.isArray(resources) && resources.length === 2, 'Only job and Scheduler may belong to the operational stack');
  const job = resources.find(r => r.address === 'google_cloud_run_v2_job.scraper');
  const scheduler = resources.find(r => r.address === 'google_cloud_scheduler_job.scraper');
  assert(job && scheduler);
  jobContract(job.values, candidate, releaseId);
  schedulerContract(scheduler.values);
  for (const change of plan.resource_changes ?? []) {
    assert([job.address, scheduler.address].includes(change.address));
    assert.deepEqual(change.mode, 'managed');
    assert(change.change.actions.length === 1 && ['no-op', 'update'].includes(change.change.actions[0]), 'Creation, deletion and replacement require administrative review');
  }
  return (plan.resource_changes ?? []).filter(c => c.change.actions[0] !== 'no-op').map(c => ({ address: c.address, actions: c.change.actions }));
}

// Exclude server-generated execution metadata; compare all configuration that the two resources own.
export function planFingerprint(plan) {
  const keys = {
    google_cloud_run_v2_job: ['project', 'location', 'name', 'labels', 'deletion_protection', 'template', 'binary_authorization'],
    google_cloud_scheduler_job: ['project', 'region', 'name', 'description', 'schedule', 'time_zone', 'attempt_deadline', 'paused', 'retry_config', 'http_target', 'pubsub_target', 'app_engine_http_target'],
  };
  const changes = (plan.resource_changes ?? []).map(r => ({
    address: r.address, actions: r.change.actions,
    before: Object.fromEntries((keys[r.type] ?? []).map(k => [k, r.change.before?.[k]])),
    after: Object.fromEntries((keys[r.type] ?? []).map(k => [k, r.change.after?.[k]])),
  })).sort((a, b) => a.address.localeCompare(b.address));
  return createHash('sha256').update(JSON.stringify(changes)).digest('hex');
}

export function validateManifest(value, now = Date.now()) {
  validateCandidate(value);
  assert.match(value.releaseId, /^\d+$/);
  assert.match(value.planHash, /^[a-f0-9]{64}$/);
  assert.match(value.planFingerprint, /^[a-f0-9]{64}$/);
  assert.match(value.planGeneration, /^\d+$/);
  const age = now - Date.parse(value.createdAt);
  assert(Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000, 'Approval expired: prepare a new plan');
  return value;
}
