// Install-layout-independent paths. Both supported layouts share one shape:
//   <root>/skills/do-shit/scripts/lib   (this file)
//   <root>/agents/<role>.md
//   <root>/hooks/lib/redact.jq
// where <root> is ~/.claude (hand-installed) or the plugin root.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const ROOT = join(SKILL_DIR, '../..');
export const REPORT_SCHEMA = join(SKILL_DIR, 'schemas/report.schema.json');
export const REDACT_LIB = process.env.DO_SHIT_REDACT_LIB || join(ROOT, 'hooks/lib');

// Installed as a plugin: role agents are namespaced `do-shit:<role>`.
export const PLUGIN = existsSync(join(ROOT, '.claude-plugin/plugin.json'));
export const PLUGIN_NAME = 'do-shit';

const USER_AGENTS = () => process.env.DO_SHIT_AGENTS_DIR || join(homedir(), '.claude/agents');

// A user-level agent (~/.claude/agents/<role>.md) overrides the bundled one.
export function userAgentFile(role) {
  const p = join(USER_AGENTS(), `${role}.md`);
  return existsSync(p) ? p : null;
}

export function agentFile(role) {
  const bundled = join(ROOT, 'agents', `${role}.md`);
  return userAgentFile(role) || (existsSync(bundled) ? bundled : null);
}
