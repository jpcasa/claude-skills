# Tracker: Linear

Access: a Linear MCP connector (Linear's official MCP, or Composio's `linear` toolkit). Find the tools with ToolSearch, keyword `linear`. Read-only tools only: get/list/search issues, list teams.

## Setup

```json
"tracker": {
  "type": "linear",
  "team_keys": ["ENG"],
  "id_pattern": "\\b(ENG)-[0-9]+\\b",
  "url_template": "https://linear.app/<workspace>/issue/{id}"
}
```

- `team_keys`: from the list-teams tool, confirmed against keys seen in the PR sample.
- `id_pattern`: built from the team keys. Linear branch names lower-case the key (`jane/eng-123-fix-login`), so match case-insensitively and upper-case the result.
- `url_template`: the workspace slug from any issue URL in the sample or from the connector.

## Ticket ID

```bash
gh pr view <n> --repo <repo> --json headRefName,body \
  --jq '.headRefName + " " + .body' | grep -oiE '<id_pattern>' | tr a-z A-Z | sort -u
```

Then the shared precedence (branch name wins). Link with `url_template`.

## In progress

List issues per team with a created-at filter of the last N days (`createdAt >= <ISO date>`), limit 30, returning title, state, assignee, URL. One call per team, within the 6-call budget.
