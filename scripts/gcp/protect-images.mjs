import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { project, region, imagePrefix } from './release-policy.mjs';

function run(args) {
  // Windows SDK provides a .cmd launcher; RTK resolves it without shell strings.
  const result = spawnSync(process.platform === 'win32' ? 'rtk' : 'gcloud', process.platform === 'win32' ? ['proxy', 'gcloud', ...args] : args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const json = args => JSON.parse(run([...args, '--format=json']));
const job = json(['run', 'jobs', 'describe', 'farejo-scraper', `--project=${project}`, `--region=${region}`]);
const current = job.spec.template.spec.template.spec.containers[0].image;
assert(current.startsWith(imagePrefix + ':') || current.startsWith(imagePrefix + '@sha256:'));
const image = json(['artifacts', 'docker', 'images', 'describe', current, `--project=${project}`]).image_summary.fully_qualified_digest;
assert.match(image.slice(imagePrefix.length), /^@sha256:[a-f0-9]{64}$/);
assert(image.startsWith(imagePrefix));
// Bootstrap only: never overwrite previous/current pins of an existing release.
const tags = json(['artifacts', 'docker', 'tags', 'list', imagePrefix, `--project=${project}`]);
assert(!tags.some(tag => /\/tags\/protected-(current|previous)$/.test(tag.name)), 'Pins already exist; inspect instead of resetting rollback history');
for (const tag of ['protected-current', 'protected-previous']) {
  run(['artifacts', 'docker', 'tags', 'add', image, `${imagePrefix}:${tag}`, `--project=${project}`, '--quiet']);
  const pinned = json(['artifacts', 'docker', 'images', 'describe', `${imagePrefix}:${tag}`, `--project=${project}`]);
  assert.equal(pinned.image_summary.fully_qualified_digest, image);
}
console.log(`Initial current/previous pins verified: ${image}. Cleanup remains in dry run until a separate approved apply.`);
