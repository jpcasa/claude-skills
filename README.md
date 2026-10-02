# claude-skills

Claude Code plugins for everyday engineering work, published as a plugin marketplace.

| Plugin | What it does |
|---|---|
| [`do-shit`](plugins/do-shit) | Takes GitHub issues, ClickUp tasks or Linear issues to merged PRs: investigator plans, role-based subagent teams, a deterministic harness, one PR per leaf, gated merge, optional QA with evidence. |

## Install

```bash
claude plugin marketplace add jpcasa/claude-skills
claude plugin install do-shit@jpcasa-skills
```

Or inside a session: `/plugin marketplace add jpcasa/claude-skills`, then `/plugin install do-shit@jpcasa-skills`. Start a new session afterwards.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest
plugins/<name>/
  .claude-plugin/plugin.json      plugin manifest
  skills/  agents/  hooks/        plugin components
```

## Develop

```bash
claude plugin validate .
node --test plugins/do-shit/skills/do-shit/scripts/test/*.test.mjs
```

## License

MIT
