// Local git operations the harness owns (deterministic, never outward-facing).
// Pushes, PRs and merges are the orchestrator's job, not this module's.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

export const mainRoot = (cwd) =>
  git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).replace(/\/\.git$/, '');

export const headSha = (wt) => git(wt, ['rev-parse', 'HEAD']);

export function baseRef(repo, base) {
  return tryGit(repo, ['rev-parse', '--verify', '--quiet', `origin/${base}`]) ? `origin/${base}` : base;
}

// Most common "<owner>/" prefix among branches, excluding type prefixes.
export function ownerPrefix(repo) {
  const refs = (tryGit(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']) || '')
    .split('\n')
    .map((r) => r.replace(/^origin\//, ''))
    .filter((r) => r.includes('/'));
  const skip = new Set(['feature', 'feat', 'fix', 'bugfix', 'hotfix', 'chore', 'release', 'dependabot', 'renovate', 'claude', 'codex', 'HEAD']);
  const counts = {};
  for (const r of refs) {
    const p = r.split('/')[0];
    if (!skip.has(p)) counts[p] = (counts[p] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const name = tryGit(repo, ['config', 'user.name']) || 'agent';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function addWorktree(repo, path, branch, from) {
  if (existsSync(path)) return { path, reused: true };
  const exists = tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  git(repo, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', path, '-b', branch, from]);
  return { path, reused: false };
}

// Non-forced: a dirty worktree is reported, never discarded.
export function removeWorktree(repo, path) {
  if (!existsSync(path)) return { ok: true, skipped: true };
  try {
    git(repo, ['worktree', 'remove', path]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.stderr?.toString().trim() || e.message };
  }
}

export function changedSince(wt, sha) {
  const out = git(wt, ['diff', '--name-only', `${sha}..HEAD`]);
  return out ? out.split('\n') : [];
}

export const isDirty = (wt) => git(wt, ['status', '--porcelain']).length > 0;

export function diffstat(wt, from) {
  return tryGit(wt, ['diff', '--stat', `${from}...HEAD`]) || '';
}
