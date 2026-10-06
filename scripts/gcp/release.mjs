import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { project, region, repository, imagePrefix, validateCandidate, validateManifest, validatePlan, validateUpstream, relevantPaths, planFingerprint } from './release-policy.mjs';

const directory = '.local/release';
mkdirSync(directory, { recursive: true });
function run(tool, args, inherit = false) {
  const result = spawnSync(tool, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  if (result.status !== 0) {
    if (!inherit) writeFileSync(`${directory}/last-error.log`, result.stderr ?? '');
    throw new Error(`${tool} failed (${result.status}); inspect the private diagnostic file`);
  }
  return result.stdout?.trim() ?? '';
}
const json = (tool, args) => JSON.parse(run(tool, args));
const api = path => json('gh', ['api', `repos/${repository}/${path}`]);
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function output(name, value) {
  assert(!String(value).includes('\n'));
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function summary(text) { appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n'); }
function assertCurrent(sha) {
  assert.equal(api('branches/master').commit.sha, sha, 'Release is no longer the current master');
  assert.equal(run('git', ['rev-parse', 'HEAD']), sha, 'Checkout differs from the tested commit');
}
function upstream(name) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const source = event.workflow_run;
  assert(source && Number.isSafeInteger(source.id));
  const run = api(`actions/runs/${source.id}`);
  validateUpstream(run, name);
  return run;
}
function checkCandidate(value) {
  const candidate = validateCandidate(value);
  assertCurrent(candidate.sha);
  const prepare = api(`actions/runs/${candidate.prepareRunId}`);
  assert.equal(validateUpstream(prepare, 'Prepare scraper release'), candidate.sha);
  const ci = api(`actions/runs/${candidate.ciRunId}`);
  assert.equal(validateUpstream(ci, 'CI'), candidate.sha);
  return candidate;
}
function job() {
  return json('gcloud', ['run', 'jobs', 'describe', 'farejo-scraper', `--project=${project}`, `--region=${region}`, '--format=json']);
}
function baseline(value) {
  return {
    image: value.spec.template.spec.template.spec.containers[0].image,
    sourceSha: value.metadata.labels?.source_sha ?? null,
    releaseId: value.metadata.labels?.release_id ?? null,
  };
}
function configureBackend() {
  assert.equal(process.env.GCP_PROJECT_ID, project);
  assert.equal(process.env.GCP_REGION, region);
  assert.equal(process.env.GCP_TF_STATE_BUCKET, `${project}-tfstate`);
  assert.equal(process.env.GCP_RELEASE_BUCKET, `${project}-releases`);
  copyFileSync('infra/gcp/runtime/backend.tf.example', 'infra/gcp/runtime/backend.tf');
  run('terraform', ['-chdir=infra/gcp/runtime', 'init', '-input=false', '-lockfile=readonly',
    `-backend-config=bucket=${process.env.GCP_TF_STATE_BUCKET}`, '-backend-config=prefix=scraper-prod']);
}
function plan(candidate, id, filename) {
  run('terraform', ['-chdir=infra/gcp/runtime', 'plan', '-input=false', '-lock-timeout=60s',
    `-var=project_id=${project}`, `-var=region=${region}`, `-var=image_uri=${candidate.image}`,
    `-var=release_id=${id}`, `-var=source_sha=${candidate.sha}`, `-out=../../../${filename}`]);
  const value = json('terraform', ['-chdir=infra/gcp/runtime', 'show', '-json', `../../../${filename}`]);
  const changes = validatePlan(value, candidate, id);
  return { value, changes };
}
function storage(path) { return `gs://${project}-releases/${path}`; }
function object(path) { return json('gcloud', ['storage', 'objects', 'describe', storage(path), '--format=json']); }
function immutableUpload(local, path) { run('gcloud', ['storage', 'cp', local, storage(path), '--if-generation-match=0']); }

const action = process.argv[2];
if (action === 'select') {
  const ci = upstream('CI');
  assert.equal(ci.event, 'push');
  assertCurrent(ci.head_sha);
  let previous;
  // A missing workflow is expected during the first release; other API failures must stop preparation.
  const workflows = api('actions/workflows?per_page=100').workflows;
  const workflow = workflows.find(w => w.path === '.github/workflows/gcp-deploy.yml');
  if (workflow) previous = api(`actions/workflows/${workflow.id}/runs?branch=master&status=success&per_page=1`).workflow_runs[0]?.head_sha;
  const paths = previous ? run('git', ['diff', '--name-only', previous, ci.head_sha]).split('\n') : ['Dockerfile'];
  const relevant = relevantPaths(paths);
  output('relevant', String(relevant));
  output('sha', ci.head_sha);
  output('ci_run_id', String(ci.id));
  summary(relevant ? `Preparing scraper candidate for \`${ci.head_sha}\`.` : 'No scraper or infrastructure changes since the last successful publication.');
} else if (action === 'archive') {
  const sha = process.env.SOURCE_SHA;
  assertCurrent(sha);
  mkdirSync('.local/tested-image', { recursive: true });
  const image = json('docker', ['image', 'inspect', `farejo-candidate:${sha}`])[0];
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], sha);
  run('docker', ['save', '-o', '.local/tested-image/image.tar', `farejo-candidate:${sha}`]);
  save('.local/tested-image/proof.json', { sha, ciRunId: process.env.CI_RUN_ID, imageId: image.Id, archiveHash: hash('.local/tested-image/image.tar'), containerTest: 'passed' });
} else if (action === 'load') {
  const proof = JSON.parse(readFileSync('.local/tested-image/proof.json', 'utf8'));
  assertCurrent(proof.sha);
  assert.equal(proof.sha, process.env.SOURCE_SHA);
  assert.equal(proof.ciRunId, process.env.CI_RUN_ID);
  assert.equal(proof.containerTest, 'passed');
  assert.match(proof.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(hash('.local/tested-image/image.tar'), proof.archiveHash);
  run('docker', ['load', '-i', '.local/tested-image/image.tar']);
  const image = json('docker', ['image', 'inspect', `farejo-candidate:${proof.sha}`])[0];
  assert.equal(image.Id, proof.imageId, 'Image differs from the tested artifact');
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], proof.sha);
} else if (action === 'publish') {
  const sha = process.env.SOURCE_SHA;
  assertCurrent(sha);
  const localImage = `farejo-candidate:${sha}`;
  const tag = `${imagePrefix}:${sha}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  run('gcloud', ['auth', 'configure-docker', `${region}-docker.pkg.dev`, '--quiet']);
  run('docker', ['tag', localImage, tag]);
  run('docker', ['push', tag], true);
  const digests = json('docker', ['image', 'inspect', tag])[0].RepoDigests;
  const image = digests.find(d => d.startsWith(imagePrefix + '@sha256:'));
  const candidate = validateCandidate({ sha, image, prepareRunId: process.env.GITHUB_RUN_ID, ciRunId: process.env.CI_RUN_ID, containerTest: 'passed' });
  mkdirSync('.local/candidate', { recursive: true });
  save('.local/candidate/candidate.json', candidate);
  summary(`Tested candidate: \`${image}\`. Publishing the candidate does not activate it.`);
} else if (action === 'probe') {
  const prepare = upstream('Prepare scraper release');
  const artifacts = api(`actions/runs/${prepare.id}/artifacts`).artifacts;
  output('ready', String(artifacts.some(a => a.name === 'scraper-candidate' && !a.expired)));
} else if (action === 'plan') {
  const prepare = upstream('Prepare scraper release');
  const candidate = checkCandidate(JSON.parse(readFileSync('.local/candidate/candidate.json', 'utf8')));
  assert.equal(candidate.prepareRunId, String(prepare.id));
  configureBackend();
  const releaseId = process.env.GITHUB_RUN_ID;
  const previous = baseline(job());
  const filename = `${directory}/approved.tfplan`;
  const prepared = plan(candidate, releaseId, filename);
  const planPath = `plans/${releaseId}/approved.tfplan`;
  immutableUpload(filename, planPath);
  const manifest = {
    ...candidate, releaseId, previous, createdAt: new Date().toISOString(),
    planHash: hash(filename), planFingerprint: planFingerprint(prepared.value), planGeneration: String(object(planPath).generation),
  };
  save(`${directory}/manifest.json`, validateManifest(manifest));
  immutableUpload(`${directory}/manifest.json`, `releases/${releaseId}/manifest.json`);
  summary(`## Scraper release ${releaseId}\n\nCommit: \`${candidate.sha}\`\n\nImage: \`${candidate.image}\`\n\nChanges:\n${prepared.changes.map(c => '- ' + c.address + ': ' + c.actions.join(', ')).join('\n')}\n\nApprove by dispatching **Deploy scraper production**, release ID **${releaseId}**. Valid for 24 hours. No scheduled execution is started or awaited.`);
} else if (action === 'deploy') {
  const releaseId = process.env.RELEASE_ID;
  assert.match(releaseId, /^\d+$/);
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/master');
  assert.equal(process.env.GITHUB_ACTOR_ID, '54454575');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  const manifestPath = storage(`releases/${releaseId}/manifest.json`);
  const manifest = validateManifest(json('gcloud', ['storage', 'cat', manifestPath]));
  assert.equal(manifest.releaseId, releaseId);
  checkCandidate(manifest);
  const plannedRun = api(`actions/runs/${releaseId}`);
  assert.equal(validateUpstream(plannedRun, 'Plan scraper release'), manifest.sha);
  const filename = `${directory}/approved.tfplan`;
  run('gcloud', ['storage', 'cp', storage(`plans/${releaseId}/approved.tfplan`) + '#' + manifest.planGeneration, filename]);
  assert.equal(hash(filename), manifest.planHash, 'Saved plan integrity mismatch');
  configureBackend();
  const saved = json('terraform', ['-chdir=infra/gcp/runtime', 'show', '-json', `../../../${filename}`]);
  validatePlan(saved, manifest, releaseId);
  assert.equal(planFingerprint(saved), manifest.planFingerprint);
  assert.deepEqual(baseline(job()), manifest.previous, 'Production changed or this release was already applied');
  const refreshed = plan(manifest, releaseId, `${directory}/refreshed.tfplan`);
  assert.equal(planFingerprint(refreshed.value), manifest.planFingerprint, 'Infrastructure changed: prepare a new approval');
  assertCurrent(manifest.sha);
  const previousImage = manifest.previous.image;
  assert(previousImage.startsWith(imagePrefix + '@sha256:') || new RegExp('^' + imagePrefix.replaceAll('.', '\\.') + ':[a-f0-9]{40}$').test(previousImage));
  // Protect both sides before changing the job. A failed apply retains both images.
  run('gcloud', ['artifacts', 'docker', 'tags', 'add', previousImage, imagePrefix + ':protected-previous', `--project=${project}`, '--quiet']);
  run('gcloud', ['artifacts', 'docker', 'tags', 'add', manifest.image, imagePrefix + ':protected-current', `--project=${project}`, '--quiet']);
  run('terraform', ['-chdir=infra/gcp/runtime', 'apply', '-input=false', '-lock-timeout=60s', `../../../${filename}`]);
  const current = job();
  assert.equal(baseline(current).image, manifest.image);
  assert.equal(baseline(current).sourceSha, manifest.sha);
  assert.equal(baseline(current).releaseId, releaseId);
  assert.equal(current.spec.template.spec.template.spec.serviceAccountName, `farejo-scraper-runner@${project}.iam.gserviceaccount.com`);
  const scheduler = json('gcloud', ['scheduler', 'jobs', 'describe', 'farejo-scrape-0900-brt', `--project=${project}`, `--location=${region}`, '--format=json']);
  assert.equal(scheduler.state, 'ENABLED');
  assert.equal(scheduler.schedule, '0 9 * * *');
  assert.equal(scheduler.timeZone, 'America/Sao_Paulo');
  summary(`Published release **${releaseId}**, commit \`${manifest.sha}\`, image \`${manifest.image}\`. Job and Scheduler configuration verified. Pipeline complete.`);
} else {
  throw new Error('Expected select, archive, load, publish, probe, plan or deploy');
}
