# Tracker: other (Jira, Asana, Shortcut, Notion, …)

For any tracker reachable through an MCP connector or a CLI in this session.

## Setup

1. Find the tools: ToolSearch with the tracker's name. None found: tell the user which connector to add, write the config with `type: "other"`, and skip In progress until it's connected.
2. Record what the next run needs:

```json
"tracker": {
  "type": "other",
  "name": "Jira",
  "tool_hint": "atlassian",
  "id_pattern": "\\b(PROJ)-[0-9]+\\b",
  "url_template": "https://acme.atlassian.net/browse/{id}",
  "scope": "project PROJ"
}
```

- `tool_hint`: the ToolSearch keyword that found the tools.
- `scope`: the project, board, or list to query, in the tracker's own terms.
- `id_pattern` and `url_template`: derived from the PR sample, as for the built-in adapters.

## Ticket ID

`grep -oiE '<id_pattern>'` over branch name and body, then the shared precedence. Link with `url_template`.

## In progress

Load the tools via `tool_hint`. Use the tool's search/list with a created-after filter of N days, limited to `scope`, read-only. If the tool can't filter by creation date, say so and skip the section rather than enumerating everything.
