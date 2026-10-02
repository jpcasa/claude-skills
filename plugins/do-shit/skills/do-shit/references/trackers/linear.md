# Tracker adapter: Linear

> **experimental: untested until Linear is connected in Composio.** The slugs and schemas below were discovered read-only on 2026-09-28 with `COMPOSIO_SEARCH_TOOLS`/`COMPOSIO_GET_TOOL_SCHEMAS`, and none has been executed. The GraphQL field names are unverified. Run the introspection in Setup on the first real run and fix this file.

- **Purpose:** map Linear issues (and their sub-issues) to the normalized item, and do every tracker write /do-shit needs.
- **Access:** Composio. Search with `mcp__composio__COMPOSIO_SEARCH_TOOLS` (always pass `session`), then execute with `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL { tools: [{ tool_slug, arguments, account }], sync_response_to_workbench: false }`. **Every entry names `account`.**
- **Only the orchestrator writes.** Agents never execute `LINEAR_UPDATE_ISSUE`, `LINEAR_CREATE_*`, mutations through `LINEAR_RUN_QUERY_OR_MUTATION`, or `LINEAR_MCP_SAVE_*`/`LINEAR_MCP_*UPLOAD*`. Under `--dry-run`, log each write as a no-op.
- If a PreToolUse guard prompts on Composio writes, expect `ask` prompts on Linear writes. Don't bypass them.

## Setup (first use)

1. **Connection.** Toolkit `linear` (or `linear_mcp`) needs an active Composio connection.
   - If `COMPOSIO_SEARCH_TOOLS` reports `has_active_connection: false`, stop Linear intake and ask the user.
   - On a yes, run `COMPOSIO_MANAGE_CONNECTIONS { toolkits: [{ name: "linear" }] }`, show the returned `redirect_url` as a markdown link, and wait. Then confirm with `action: "list"`.
2. **Account.** Use the connected `linear` account. If there are several, ask once.
3. **Slugs.** Re-discover with `COMPOSIO_SEARCH_TOOLS { queries: [{use_case: "get a Linear issue …"}, …], search_strategy: "tool_search", session: {generate_id: true} }` (max 7 queries per call). Fetch the exact params with `COMPOSIO_GET_TOOL_SCHEMAS { tool_slugs: [...], session_id }`. Never guess a slug.
4. **Schema check.** Run through `LINEAR_RUN_QUERY_OR_MUTATION`:
   - `query { __type(name:"Issue") { fields { name } } }`
   - `query { __type(name:"IssueRelation") { fields { name } } }`
   Confirm `children`, `parent`, `relations`, `inverseRelations`, `branchName` and `attachments` exist.

## Slugs (toolkit `linear`; the `linear_mcp` alternative in the right column)

| Op | Primary slug | Key args | `linear_mcp` alternative |
|---|---|---|---|
| fetch (full graph) | `LINEAR_RUN_QUERY_OR_MUTATION` | `query_or_mutation`, `variables` | `LINEAR_MCP_GET_ISSUE { id, includeRelations: true }` |
| fetch (flat) | `LINEAR_GET_LINEAR_ISSUE` | `issue_id` (`ENG-123` or UUID, never a URL). Has no parent, children or relations. | — |
| comments | included in the fetch query; `LINEAR_LIST_COMMENTS` is workspace-wide | — | `LINEAR_MCP_LIST_COMMENTS { issueId }` |
| status_names | included in the fetch query (`team.states`); else `LINEAR_LIST_LINEAR_STATES` | `team_id` (UUID) | `LINEAR_MCP_LIST_ISSUE_STATUSES { team }` |
| status_write | `LINEAR_UPDATE_ISSUE` | `issueId` (`ENG-123` ok), `stateId` (**UUID only**) | `LINEAR_MCP_SAVE_ISSUE { id, state }` (name ok) |
| comment | `LINEAR_CREATE_LINEAR_COMMENT` | `issueId`, `body` | `LINEAR_MCP_SAVE_COMMENT { issueId, body }` |
| create_child | `LINEAR_CREATE_LINEAR_ISSUE` | `team_id`, `title`, `description`, `parent_id`, `label_ids` (all UUIDs) | `LINEAR_MCP_SAVE_ISSUE { team, title, description, parentId, labels }` |
| labels: list | `LINEAR_LIST_LINEAR_LABELS` | `team_id` | — |
| labels: create | `LINEAR_CREATE_LINEAR_LABEL` | `team_id`, `name`, `color` (returns the existing label if the name is taken) | — |
| labels: add | `LINEAR_UPDATE_ISSUE` | `labelIds` **replaces all**, so send existing ids plus the new one | `LINEAR_MCP_SAVE_ISSUE { id, addLabels: [name] }` (append-only; preferred) |
| attach: upload | `LINEAR_RUN_QUERY_OR_MUTATION` with the `fileUpload` mutation, then HTTP PUT | see attach | `LINEAR_MCP_PREPARE_ATTACHMENT_UPLOAD` → PUT → `LINEAR_MCP_CREATE_ATTACHMENT_FROM_UPLOAD` |
| attach: link row | `LINEAR_CREATE_ATTACHMENT` | `issue_id`, `title`, `url` | — |
| search | `LINEAR_SEARCH_ISSUES` | `query` | `LINEAR_MCP_LIST_ISSUES { parentId }` |

## parse_ref

| Input | Regex | id |
|---|---|---|
| `ENG-123` | `^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$` | upper-cased `ENG-123` |
| `https://linear.app/<ws>/issue/ENG-123/<slug>` | `linear\.app/[^/]+/issue/([A-Za-z][A-Za-z0-9]{0,9}-\d+)` | `ENG-123` |

- `P-ENG-123` is a project, so reject it.
- `ABC-123` can also be a ClickUp custom id. Default to Linear, and ask if Linear isn't connected.

## fetch

```json
{ "tool_slug": "LINEAR_RUN_QUERY_OR_MUTATION", "account": "<linear alias>", "arguments": {
  "query_or_mutation": "query($id:String!){ issue(id:$id){ id identifier title url description branchName state{ id name type position } team{ id key states{ nodes{ id name type position } } } parent{ id identifier } children(first:100){ nodes{ id identifier title state{ name type } children(first:1){ nodes{ id } } } } labels{ nodes{ id name } } relations(first:50){ nodes{ type relatedIssue{ identifier } } } inverseRelations(first:50){ nodes{ type issue{ identifier } } } attachments(first:50){ nodes{ title url } } comments(first:100){ nodes{ body user{ name } } } } }",
  "variables": { "id": "ENG-123" } } }
```

`issue(id:)` takes a `String!` and accepts the identifier. Connections have `nodes` and `pageInfo`, with **no `totalCount`**.

| Normalized | Source |
|---|---|
| `tracker` | `"linear"` |
| `id` | `identifier` (keep `id` (the UUID) and `team.id` in run state for writes) |
| `ref` | `identifier` |
| `url` | `url` |
| `title` | `title` |
| `body` | `description` (markdown) |
| `acceptance_criteria` | Same rule as `github.md` `def ac`: bullets under an `Acceptance criteria` heading or bold line, else `- [ ]` items, else `[]` |
| `status` / `status_type` | `state.name` / classify (status_names) |
| `parent` | `parent.identifier` or null |
| `children` | `children.nodes[].identifier` |
| `leaf` | no child with `state.type` outside `completed`/`canceled` |
| `labels` | `labels.nodes[].name` |
| `links.blocks` | `relations.nodes[type=="blocks"].relatedIssue.identifier` |
| `links.blocked_by` | `inverseRelations.nodes[type=="blocks"].issue.identifier` |
| `attachments` | `attachments.nodes[] → {name: title, url}`, plus `uploads.linear.app` image URLs in `description`/comments. Embedded screenshots are uploads, not attachment rows. |
| `comments` | `comments.nodes[] → {author: user.name, body}` (`user` is null for integrations; use `"integration"`) |
| `repo` | `null` (the run uses the cwd repo) |

## children (recursive)

- **Actionable child:** `state.type` in `triage|backlog|unstarted`, or `started` classified as `in_progress`. Fetch it with the query above, and recurse if `children.nodes` is non-empty.
- **Skipped child:** `completed`, `canceled`, or `started` classified as `review`/`qa`. List it as `{id: identifier, title, reason: "state <name>"}` and don't recurse.
- Output a flat `items` array plus `skipped` (same shape as GitHub `tree.sh`).

## status_names

The valid states are `team.states.nodes[]` from the fetch (team-scoped; names aren't unique across teams, so always write by `id`). Classify them in this order:

1. `type: "canceled"` → `closed`
2. `type: "completed"` → `done`
3. Name regex, case-insensitive, first match wins:
   - `/reopen/` → `open` (reopen target)
   - `/qa|test|verif/` → `qa`
   - `/review/` → `review`
   - `/progress|doing|started/` → `in_progress`
   - `/done|complete|closed|shipped/` → `done`
   - `/todo|to do|open|backlog/` → `open`
4. `type` `triage|backlog|unstarted` → `open`. `started` with no name match → `in_progress`.

To pick the **target**:
1. The `do-shit.json` override.
2. Otherwise the exact canonical name (`In Progress`, `In Review`, `QA`, `Done`).
3. Otherwise the lowest `position` within the class.
4. For reopened: a `/reopen/` state, else the team's lowest-`position` `unstarted` state (usually `Todo`).

Never-backward order: `open < in_progress < review < qa < done`, enforced by the harness (`canMoveStatus`). The only backward move is QA failure → reopened.

## status_write

1. Re-fetch `state{ name type }` with a minimal query on `issue(id:)` and classify it.
2. If `canMoveStatus(from, to)` is false, skip and record `skipped: not ahead`.
3. Write with `LINEAR_UPDATE_ISSUE { issueId: "ENG-123", stateId: "<state uuid>" }`. It must be the UUID; a name is rejected.
4. On failure, continue the run. Record `failed: <error>` and report it at the end.

The Linear GitHub integration moves states on its own when a branch is pushed, a PR opens, or a PR merges. Always read before writing, and a skip is expected.

## restore_status

Undo the run's own in_progress move on an item it dropped.

1. Re-fetch `state{ name type }` and classify it. If the class isn't `only_if_type` (`in_progress`), skip and record `skipped: moved since`.
2. Look up the state whose `name` equals `to_name` in the team's states, then `LINEAR_UPDATE_ISSUE { issueId, stateId }`.
3. On failure, record `failed: <error>` and continue. The harness never retries a restore.

## comment

`LINEAR_CREATE_LINEAR_COMMENT { issueId: "ENG-123", body: "<markdown>" }`

- Text is terse and professional (articles kept, no filler; a user-level "outward-facing writing" rule wins): what changed, why it matters, what's next and from whom. 3–6 lines.
- Write security and data-loss notes in full prose.
- Mentions use `@displayName`.

## link_pr

| Marker | Value |
|---|---|
| Branch | `<owner>/ENG-123-<slug>`, or Linear's own `branchName`. Linear links a PR whose branch contains the identifier, case-insensitive. |
| PR title | `[ENG-123] <title>` |
| PR body, first lines | `Ref ENG-123` (links without closing), `Linear: <url>`, `Parent: <parent url>` |
| Explicit comment | `LINEAR_CREATE_LINEAR_COMMENT` with the PR URL and a one-line summary |

- Don't use closing words (`Closes`/`Fixes`/`Resolves`) for the leaf. They move the issue to Done on merge, and because statuses never move backward, the harness could no longer set the QA status. The harness moves statuses explicitly.
- Don't write `Part of ENG-100` for the parent. `Part of` is a Linear linking magic word, and it would attach the PR to the parent and trigger its automations. Use the plain URL.
- Leaf PRs only; the parent is an umbrella.

## create_child (QA bug)

1. Find the label: `LINEAR_LIST_LINEAR_LABELS { team_id }` → the `name` that case-insensitively equals `bug`.
   - Skip labels with `is_group: true`.
   - At most one label per `parent.id` group.
   - If missing: `LINEAR_CREATE_LINEAR_LABEL { team_id, name: "Bug", color: "#D73A4A" }`.
2. Create the issue:
   `LINEAR_CREATE_LINEAR_ISSUE { team_id: <item team.id>, parent_id: <item id UUID>, title: "Bug: <short>", description: "## Repro\n1. …\n\n## Expected\n…\n\n## Actual\n…\n\n## Evidence\n…\n\nFound by /do-shit QA of ENG-123, env <env>, SHA <sha>.", label_ids: [<bug label id>] }`
3. The new issue's UUID is `data.id`. Read `identifier` from the response. If it's absent, query `issue(id:"<uuid>"){ identifier }`.

## attach (screenshots)

Upload and link one file at a time. Signed URLs expire in about 60 s, so don't batch the prepare steps.

1. Get an upload URL:
   `LINEAR_RUN_QUERY_OR_MUTATION { query_or_mutation: "mutation($contentType:String!,$filename:String!,$size:Int!){ fileUpload(contentType:$contentType, filename:$filename, size:$size){ success uploadFile{ uploadUrl assetUrl headers{ key value } } } }", variables: { contentType: "image/png", filename: "<file>.png", size: <bytes from stat -f%z> } }`
2. Upload the bytes:
   `curl -sS -X PUT --data-binary @/abs/path.png -H "Content-Type: image/png" -H "Cache-Control: public, max-age=31536000" <-H "key: value" for every returned header, verbatim> "<uploadUrl>"`
   Any missing or altered signed header returns 403.
3. Link the file: `LINEAR_CREATE_ATTACHMENT { issue_id: "ENG-123", title: "<step>", url: "<assetUrl>" }`, and/or embed `![<step>](<assetUrl>)` in the evidence comment.

With `linear_mcp`: `LINEAR_MCP_PREPARE_ATTACHMENT_UPLOAD { issue, filename, contentType, size }` → PUT to `uploadRequest.url` with `uploadRequest.headers` verbatim → `LINEAR_MCP_CREATE_ATTACHMENT_FROM_UPLOAD { issue, assetUrl, title }`.

## labels

Add a label such as `agent-tests-failed`:
1. `LINEAR_LIST_LINEAR_LABELS { team_id }` → find it by name.
2. If it's missing, `LINEAR_CREATE_LINEAR_LABEL { team_id, name: "agent-tests-failed", color: "#B60205", description: "do-shit: tests did not pass within the loop cap" }`. It's idempotent, because it returns the existing label.
3. Then `LINEAR_UPDATE_ISSUE { issueId, labelIds: [<current label ids>…, <new id>] }`. `labelIds` replaces the whole set, so never send only the new id. Or use `LINEAR_MCP_SAVE_ISSUE { id, addLabels: ["agent-tests-failed"] }`, which is append-only.
