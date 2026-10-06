import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { repository } from './release-policy.mjs';

const backup = `.local/github-settings/${Date.now()}`;
mkdirSync(backup, { recursive: true });
function api(path, method = 'GET', body, optional = false) {
  const args = ['api', `repos/${repository}${path ? '/' + path : ''}`, '--method', method];
  if (body) args.push('--input', '-');
  const result = spawnSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined });
  if (optional && result.status !== 0 && result.stderr.includes('HTTP 404')) return null;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}
const info = api('');
assert.equal(info.id, 1297090348);
assert.equal(info.permissions.admin, true);
const permission = api('actions/permissions');
const workflow = api('actions/permissions/workflow');
const protection = api('branches/master/protection', 'GET', undefined, true);
const allowlist = permission.allowed_actions === 'selected' ? api('actions/permissions/selected-actions') : null;
writeFileSync(`${backup}/before.json`, JSON.stringify({ permission, workflow, protection, allowlist }, null, 2));
const config = {
  required_status_checks: {
    strict: true,
    checks: [...(protection?.required_status_checks?.checks ?? []).filter(check => check.context !== 'test'), { context: 'test', app_id: 15368 }],
  },
  enforce_admins: true,
  required_pull_request_reviews: protection?.required_pull_request_reviews ? {
    dismissal_restrictions: {
      users: (protection.required_pull_request_reviews.dismissal_restrictions?.users ?? []).map(user => user.login),
      teams: (protection.required_pull_request_reviews.dismissal_restrictions?.teams ?? []).map(team => team.slug),
      apps: (protection.required_pull_request_reviews.dismissal_restrictions?.apps ?? []).map(app => app.slug),
    },
    bypass_pull_request_allowances: {
      users: (protection.required_pull_request_reviews.bypass_pull_request_allowances?.users ?? []).map(user => user.login),
      teams: (protection.required_pull_request_reviews.bypass_pull_request_allowances?.teams ?? []).map(team => team.slug),
      apps: (protection.required_pull_request_reviews.bypass_pull_request_allowances?.apps ?? []).map(app => app.slug),
    },
    dismiss_stale_reviews: protection.required_pull_request_reviews.dismiss_stale_reviews,
    require_code_owner_reviews: protection.required_pull_request_reviews.require_code_owner_reviews,
    required_approving_review_count: protection.required_pull_request_reviews.required_approving_review_count,
    require_last_push_approval: protection.required_pull_request_reviews.require_last_push_approval,
  } : null,
  restrictions: protection?.restrictions ? {
    users: protection.restrictions.users.map(user => user.login),
    teams: protection.restrictions.teams.map(team => team.slug),
    apps: protection.restrictions.apps.map(app => app.slug),
  } : null,
  required_linear_history: protection?.required_linear_history?.enabled ?? false,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: protection?.block_creations?.enabled ?? false,
  required_conversation_resolution: true,
  lock_branch: protection?.lock_branch?.enabled ?? false,
  allow_fork_syncing: protection?.allow_fork_syncing?.enabled ?? false,
};
const selectedActions = {
  github_owned_allowed: false,
  verified_allowed: false,
  patterns_allowed: ['actions/checkout@*', 'actions/setup-node@*', 'actions/upload-artifact@*', 'actions/download-artifact@*', 'pnpm/action-setup@*', 'supabase/setup-cli@*', 'hashicorp/setup-terraform@*', 'google-github-actions/auth@*', 'google-github-actions/setup-gcloud@*'],
};
writeFileSync(`${backup}/proposed.json`, JSON.stringify({ config, selectedActions }, null, 2));
if (!process.argv.includes('--apply')) {
  console.log(`Repository configuration prepared in ${backup}; use --apply to apply and verify.`);
} else {
  // Check branch protection eligibility before changing Actions policy.
  api('branches/master/protection', 'PUT', config);
  api('actions/permissions/workflow', 'PUT', { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false });
  api('actions/permissions', 'PUT', { enabled: true, allowed_actions: 'selected', sha_pinning_required: permission.sha_pinning_required ?? false });
  api('actions/permissions/selected-actions', 'PUT', selectedActions);
  assert.equal(api('actions/permissions').allowed_actions, 'selected');
  assert.equal(api('actions/permissions/workflow').can_approve_pull_request_reviews, false);
  const current = api('branches/master/protection');
  assert(current.required_status_checks.checks.some(check => check.context === 'test' && check.app_id === 15368));
  assert.equal(current.allow_force_pushes.enabled, false);
  assert.equal(current.allow_deletions.enabled, false);
  console.log(`Repository protections verified; private recovery snapshot: ${backup}.`);
}
