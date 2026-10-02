# claude-skills

One Claude Code plugin, `real-skills`, with skills for everyday engineering work. Install once, get every skill.

| Command | What it does |
|---|---|
| `/real-skills:do-shit <refs…> [--dry-run]` | Takes GitHub issues, ClickUp tasks or Linear issues to merged PRs: investigator plans, role-based subagent teams in isolated worktrees, a deterministic harness, one PR per leaf, gated merge, optional QA with evidence. Also `resume <run-id>` and `status [<run-id>]`. |
| `/real-skills:changelog [technical\|non-technical] [--releases N] [--days N]` | Changelog for the last N releases (promotion PRs into a production branch, or git tags). Every PR gets a short summary and its tracker ticket, then an "In progress" section of recently opened tickets. Read-only. |
| `/real-skills:changelog setup` | Detects the release model, asks which tracker you use (GitHub Issues, ClickUp, Linear, none, or any other tracker with an MCP connector), derives the ticket-ID pattern from recent PRs, and writes `.claude/changelog.json`. Runs automatically on first use. |
| `/real-skills:quick-ask-me [goal]` | Short interview for quick tasks: objective, observable success criteria, then at most 6 questions that change what gets built. Writes `CONTEXT.md` glossary terms and rare ADRs as it goes, ends with a brief. User-invoked only. |

## Install

```bash
claude plugin marketplace add jpcasa/claude-skills
claude plugin install real-skills@jpcasa-skills
```

Or inside a session: `/plugin marketplace add jpcasa/claude-skills`, then `/plugin install real-skills@jpcasa-skills`. Start a new session afterwards.

## Requirements

- Node 20+, `git`, `jq`, `gh` (authenticated)
- Tracker access, only for the trackers you use:
  - **GitHub Issues:** `gh`
  - **ClickUp:** a ClickUp MCP connector (e.g. the claude.ai ClickUp connector)
  - **Linear:** a Linear MCP connector; `do-shit` uses [Composio](https://composio.dev)'s `linear` toolkit
- **Jev (optional, `do-shit` only):** a [TypeSafe](https://typesafe.ai) API key in `TYPESAFE_API_KEY`, or the macOS keychain item `typesafe-api`. Without it the harness runs in its conservative fallback. Request bodies are redacted (`hooks/lib/redact.jq`) before they leave the machine and never include source code.

## Layout

```
.claude-plugin/
  marketplace.json      marketplace "jpcasa-skills"
  plugin.json           plugin "real-skills" (root of this repo)
skills/
  do-shit/              orchestrator skill + harness (scripts/harness.mjs)
  changelog/            skill + release-ranges.sh + tracker adapters
  quick-ask-me/         skill + CONTEXT/ADR formats
agents/                 17 do-shit role agents, spawned as real-skills:<role>
hooks/                  hooks.json + guard-roles.mjs
```

## do-shit notes

- **Role guard.** `hooks/hooks.json` runs `guard-roles.mjs` on Bash/Edit/Write calls. It acts only on `real-skills:<role>` agents: read-only roles can't edit or run mutating commands, build roles edit only inside `.claude/worktrees/ds-*` and their `allowed_paths`, and no role pushes or stashes. Your other agents are untouched.
- **Overrides.** A same-name agent in `<repo>/.claude/agents/` or `~/.claude/agents/` replaces the bundled role. Plugin agents can't declare hooks, but repo and user agents can: add the guard to their frontmatter if you want it.
- **Per-repo config** in `<repo>/.claude/do-shit.json` (all keys optional): `verify`, `base`, `statuses`, `labels`, `path_rules`, `allowed_paths`, `spawn_cap`, `max_concurrent_teams`, `merge_method`, `pr_title`.
- **Run state** lives in `~/.claude/state/do-shit/` (override with `DO_SHIT_STATE_DIR`).
- **Jev calibration** (`skills/do-shit/scripts/eval/run.mjs`) needs fixtures from your own PRs in `scripts/eval/fixtures/`. They are gitignored.

## changelog notes

To add a tracker, add `skills/changelog/references/trackers/<type>.md` with **Setup**, **Ticket ID** and **In progress** sections, then list it in `references/setup.md`.

## Develop

```bash
claude plugin validate . --strict
node --test skills/do-shit/scripts/test/*.test.mjs
bash skills/changelog/scripts/test/release-ranges.test.sh
```

## License

MIT. `skills/quick-ask-me` builds on [mattpocock/skills](https://github.com/mattpocock/skills) (MIT): its interview style follows `grill-with-docs`, and `references/CONTEXT-FORMAT.md` and `references/ADR-FORMAT.md` are adapted from `domain-modeling`.
