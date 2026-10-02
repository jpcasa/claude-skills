# Tracker: GitHub Issues

Access: `gh` CLI. Read-only: `gh issue view|list`, `gh pr view`.

## Setup

```json
"tracker": { "type": "github", "repo": "<owner/name, default: the code repo>", "labels": [] }
```

`labels` optionally narrows In progress (e.g. `["bug", "feature"]`).

## Ticket ID

Prefer GitHub's own link over text matching:

```bash
gh pr view <n> --repo <repo> --json closingIssuesReferences --jq '.closingIssuesReferences[].number'
```

If empty, fall back to the shared precedence: an issue number in the branch name (`fix/123-login`, `123-login`), then `Fixes|Closes|Resolves #N` in the body. A bare `#N` is not enough; it may be a PR.

Link: `https://github.com/<tracker repo>/issues/<N>`.

## In progress

One call:

```bash
gh issue list --repo <tracker repo> --state open --limit 30 \
  --search "created:>=<YYYY-MM-DD>" \
  --json number,title,labels,assignees,url,createdAt
```

Add `--label <l>` per configured label. Status = open, plus the labels that signal state (`in progress`, `blocked`, …) if the repo uses them.
