# Tracker: ClickUp

Access: a ClickUp MCP connector (e.g. the claude.ai ClickUp connector). Find the tools with ToolSearch, keyword `clickup`. Read-only tools only: `clickup_search`, `clickup_get_task`, `clickup_get_workspace_hierarchy`, `clickup_get_list`.

## Setup

```json
"tracker": {
  "type": "clickup",
  "id_pattern": "86[0-9a-z]{7}",
  "url_template": "https://app.clickup.com/t/{id}",
  "list_ids": ["<list id>"]
}
```

- `id_pattern`: an extended regex (`grep -oiE`) for the task IDs seen in the PR sample. ClickUp IDs are short lowercase alphanumerics that usually share a prefix within a workspace; derive the prefix from the sample. Teams using custom task IDs (`ENG-123`) use that shape instead and set `url_template` to `https://app.clickup.com/t/<team id>/{id}`.
- `list_ids`: the lists where new tickets land. Find them with `clickup_get_workspace_hierarchy` (one call), confirm with the user.
- `CU-` prefixes are stripped before lookups and links.

## Ticket ID

```bash
gh pr view <n> --repo <repo> --json headRefName,body \
  --jq '.headRefName + " " + .body' | grep -oiE '<id_pattern>' | sort -u
```

Then the shared precedence (branch name wins). Link with `url_template`.

## In progress

```
clickup_search
  filters:
    asset_types: ["task"]
    created_date_from: "<today minus N days, YYYY-MM-DD>"
    location: { subcategories: <list_ids> }
  count: 30
```

One call per list, within the 6-call budget.
