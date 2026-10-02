# jp

Small everyday skills, bundled.

| Command | What it does |
|---|---|
| `/jp:changelog [technical\|non-technical] [--releases N] [--days N]` | Changelog for the last N releases. A release is a promotion PR into your production branch, or a git tag. Every PR gets a one-or-two-sentence summary and its tracker ticket, then an "In progress" section of recently opened tickets. Read-only. |
| `/jp:changelog setup` | Detects the release model, asks which tracker you use (GitHub Issues, ClickUp, Linear, none, or any other tracker with an MCP connector), derives the ticket-ID pattern from recent PRs, and writes `.claude/changelog.json`. Runs automatically on first use. |
| `/jp:quick-ask-me [goal]` | Short interview for quick tasks: objective, observable success criteria, then at most 6 questions that change what gets built. Writes `CONTEXT.md` glossary terms and rare ADRs as it goes, ends with a brief. User-invoked only. |

## Requirements

- `/jp:changelog`: `git`, `jq`, `gh` (authenticated). For ticket links and In progress: the connector for your tracker (`gh` for GitHub Issues; a ClickUp, Linear, or other MCP connector).

## Adding a tracker

Add `skills/changelog/references/trackers/<type>.md` with **Setup**, **Ticket ID** and **In progress** sections, then list it in `references/setup.md`.

## Test

```bash
bash skills/changelog/scripts/test/release-ranges.test.sh
```

Offline: a synthetic git repo and a stub `gh`.

## Credits

`quick-ask-me` builds on [mattpocock/skills](https://github.com/mattpocock/skills) (MIT): its interview style follows `grill-with-docs`, and `references/CONTEXT-FORMAT.md` and `references/ADR-FORMAT.md` are adapted from `domain-modeling`.
