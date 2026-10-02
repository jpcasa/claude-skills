// Pure policy for the /do-shit harness. Code owns these rules; Jev answers
// feed in, but vetoes, caps and status order can never be overridden by them.

import { anyMatch } from './glob.mjs';
import { OPTIONAL_ROLES, THRESHOLDS } from './questions.mjs';

export const CORE_ROLES = ['investigator', 'worker', 'tester'];
// integrator only appears in merge-fix teams; it rebases before anyone else builds.
export const BUILD_ORDER = [
  'integrator', 'data-engineer', 'worker', 'designer', 'content-creator', 'observability-engineer', 'docs-writer', 'test-engineer',
];
export const REVIEW_ROLES = ['tester', 'auditor', 'security-advisor', 'accessibility-auditor', 'performance-engineer'];
export const READ_ONLY_ROLES = new Set([
  'investigator', 'architect', ...REVIEW_ROLES, 'qa-planner', 'qa-tester',
]);

// Path rules can only ADD roles. Matched against plan files and changed files.
export const DEFAULT_PATH_RULES = [
  { pattern: '(^|/)(auth|session|login|oauth|payments?|billing|stripe|rls|polic(y|ies)|secrets?|credentials?|permissions?)([/._-]|$)', roles: ['security-advisor'] },
  { pattern: '(^|/)(migrations?|drizzle|supabase)/|(^|/)schema[^/]*$|\\.sql$', roles: ['data-engineer'] },
  { pattern: '(^|/)rls/|polic(y|ies)[^/]*\\.sql$', roles: ['security-advisor'] },
  { pattern: '(^|/)(locales|i18n|messages)/', roles: ['content-creator'] },
];

export const buildSequence = (roles) => BUILD_ORDER.filter((r) => roles.includes(r));
export const reviewSet = (roles) => REVIEW_ROLES.filter((r) => roles.includes(r));

function pathRoles(files, rules) {
  const hits = {};
  for (const rule of rules) {
    const re = new RegExp(rule.pattern, 'i');
    const file = files.find((f) => re.test(f));
    if (file) for (const r of rule.roles) hits[r] ??= `path: ${file}`;
  }
  return hits;
}

// Loop-1 role selection for one leaf.
export function pickRoles({ mode, jev, planFiles = [], pathRules = DEFAULT_PATH_RULES, threshold = THRESHOLDS.needs_role }) {
  const reasons = Object.fromEntries(CORE_ROLES.map((r) => [r, 'core']));
  const byPath = pathRoles(planFiles, pathRules);
  const jevRoles = [];
  if (jev && !jev.degraded) {
    for (const role of Object.keys(OPTIONAL_ROLES)) {
      const p = jev.answers?.[`needs_${role}`]?.noul;
      if (typeof p === 'number' && p >= threshold) jevRoles.push(role);
    }
  }
  const useJev = mode === 'live' && jev && !jev.degraded;
  if (useJev) {
    for (const r of jevRoles) reasons[r] = `jev p=${jev.answers[`needs_${r}`].noul.toFixed(2)}`;
  } else {
    reasons.auditor = 'fallback';
  }
  for (const [r, why] of Object.entries(byPath)) reasons[r] ??= why;
  const roles = Object.keys(reasons);
  return { roles, reasons, shadow: useJev ? null : { jev_roles: jevRoles } };
}

// Merge review reports into one verdict + routed failure list.
export function aggregate(reports) {
  const failures = [];
  let securityBlock = false;
  let pass = true;
  const failedReviewers = [];
  for (const r of reports) {
    if (!REVIEW_ROLES.includes(r.role)) continue;
    const failed = r.verdict === 'fail' || r.verdict === 'blocked';
    if (failed) {
      pass = false;
      failedReviewers.push(r.role);
    }
    if (r.role === 'security-advisor' && (r.verdict === 'blocked' || r.findings.some((f) => f.blocking))) {
      securityBlock = true;
      pass = false;
    }
    for (const f of r.findings) {
      if (f.blocking || failed) {
        if (f.blocking) pass = false;
        failures.push({ ...f, from: r.role, owner_role: BUILD_ORDER.includes(f.owner_role) ? f.owner_role : 'worker' });
      }
    }
  }
  return { pass, securityBlock, failures, failedReviewers: [...new Set(failedReviewers)] };
}

// Roles for loop 2+: owners of routed failures, the reviewers that failed, and tester.
export function loopRoles(agg) {
  const s = new Set(['tester', ...agg.failedReviewers]);
  for (const f of agg.failures) s.add(f.owner_role);
  if (![...s].some((r) => BUILD_ORDER.includes(r))) s.add('worker');
  return [...s];
}

const noul = (jev, id) => jev?.answers?.[id]?.noul;

// Decide what a team does after a review stage.
// Returns { action: ship|fix|replan|draft_flagged, reason, shadow? }
export function nextLoopAction({ loop, maxLoops, agg, jev, mode }) {
  if (agg.pass) return { action: 'ship', reason: 'all reviewers passed' };

  // Hard veto: failing work never ships. From here on it is fix / replan / flag.
  let jevAction = null;
  let jevReason = '';
  if (jev && !jev.degraded) {
    const stuck = noul(jev, 'same_failure_as_last_loop');
    const wrong = noul(jev, 'plan_is_wrong');
    const choice = jev.answers?.next_action;
    if (loop >= 2 && stuck >= THRESHOLDS.same_failure_as_last_loop) {
      jevAction = 'draft_flagged';
      jevReason = `stuck: same failure as last loop (p=${stuck.toFixed(2)})`;
    } else if (wrong >= THRESHOLDS.plan_is_wrong) {
      jevAction = 'replan';
      jevReason = `plan is wrong (p=${wrong.toFixed(2)})`;
    } else if (choice?.choice === 'escalate' && choice.confidence >= 0.6) {
      jevAction = 'draft_flagged';
      jevReason = `jev escalate (conf=${choice.confidence.toFixed(2)})`;
    } else {
      jevAction = 'fix';
      jevReason = 'fixable failures';
    }
  }

  const fallback = loop >= maxLoops
    ? { action: 'draft_flagged', reason: `loop cap ${maxLoops} reached` }
    : { action: 'fix', reason: agg.securityBlock ? 'security block' : 'review failures' };

  if (fallback.action === 'draft_flagged') return { ...fallback, shadow: jevAction ? { jev_action: jevAction, jev_reason: jevReason } : undefined };
  if (mode === 'live' && jevAction) return { action: jevAction, reason: jevReason };
  return { ...fallback, shadow: jevAction ? { jev_action: jevAction, jev_reason: jevReason } : undefined };
}

// Role scope enforcement (post-hoc, from git).
export function scopeCheck({ role, readOnly, allowedPaths = [], changedFiles, dirty }) {
  if (readOnly) {
    const ok = !dirty && changedFiles.length === 0;
    return { ok, outside: changedFiles, reason: ok ? '' : `${role} is read-only but changed the tree` };
  }
  const outside = changedFiles.filter((f) => !anyMatch(allowedPaths, f));
  const ok = outside.length === 0 && !dirty;
  return {
    ok,
    outside,
    reason: ok ? '' : dirty ? `${role} left uncommitted changes` : `${role} committed outside allowed_paths: ${outside.join(', ')}`,
  };
}

const STATUS_ORDER = { open: 0, in_progress: 1, review: 2, qa: 3, done: 4 };
export function canMoveStatus(from, to) {
  if (to === 'reopened') return from === 'qa' || from === 'done';
  if (from === null || from === undefined || from === 'reopened') return to in STATUS_ORDER;
  return (STATUS_ORDER[to] ?? -1) > (STATUS_ORDER[from] ?? 99);
}

export const canSpawn = (run, n) => run.spawns_used + n <= run.spawn_cap;
