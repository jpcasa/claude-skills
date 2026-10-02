# do-shit

`/do-shit:do-shit <refs…> [--dry-run]` takes tracker items to merged PRs.

1. **Plan.** One investigator per leaf validates the premise against the code and writes a plan with acceptance criteria. An architect writes a shared contract when leaves share an interface.
2. **Build and review loop.** Role-based teams (worker, designer, data-engineer, tester, auditor, security-advisor, …) run in isolated worktrees under `.claude/worktrees/ds-*`. A deterministic Node harness owns state and every loop decision.
3. **PRs.** One PR per leaf item.
4. **Merge.** In a safe order, after your approval.
5. **QA (optional).** Browser walkthrough with screenshots posted back to the ticket.

Other forms: `/do-shit:do-shit resume <run-id>`, `/do-shit:do-shit status [<run-id>]`.

## Requirements

- Node 20+, `git`, `jq`
- **GitHub:** `gh` CLI, authenticated
- **ClickUp:** the claude.ai ClickUp connector
- **Linear:** a [Composio](https://composio.dev) MCP connection with the `linear` toolkit
- **Jev (optional):** a [TypeSafe](https://typesafe.ai) API key in `TYPESAFE_API_KEY`, or the macOS keychain item `typesafe-api`. Without it the harness runs in its conservative fallback. Request bodies are redacted (`hooks/lib/redact.jq`) before they leave the machine, and never include source code.

## What ships

| Path | Role |
|---|---|
| `skills/do-shit/` | Orchestrator skill, harness (`scripts/harness.mjs`), tracker adapters, schemas |
| `agents/*.md` | 17 role agents, spawned as `do-shit:<role>` |
| `hooks/hooks.json` + `hooks/guard-roles.mjs` | PreToolUse guard for `do-shit:*` agents: read-only roles can't edit or run mutating commands, build roles edit only inside `ds-*` worktrees and their `allowed_paths`, no role pushes or stashes. Other agents are untouched. |

## Overrides

- A same-name agent in `<repo>/.claude/agents/` or `~/.claude/agents/` replaces the bundled role. Plugin agents can't declare hooks, but repo and user agents can: add the guard to their frontmatter if you want it.
- Per-repo config in `<repo>/.claude/do-shit.json` (all keys optional): `verify`, `base`, `statuses`, `labels`, `path_rules`, `allowed_paths`, `spawn_cap`, `max_concurrent_teams`, `merge_method`, `pr_title`.
- Run state lives in `~/.claude/state/do-shit/` (override with `DO_SHIT_STATE_DIR`).

## Test

```bash
node --test skills/do-shit/scripts/test/*.test.mjs
```

Jev calibration (`scripts/eval/run.mjs`) needs fixtures from your own PRs in `scripts/eval/fixtures/`. They are gitignored.
