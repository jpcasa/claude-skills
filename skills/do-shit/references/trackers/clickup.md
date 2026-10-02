# Tracker adapter: ClickUp

- **Purpose:** map ClickUp tasks (and their subtasks) to the normalized item, and do every tracker write /do-shit needs.
- **Access:** the claude.ai ClickUp connector. The tool prefix differs by host: `mcp__claude_ai_ClickUp__clickup_*` in the CLI, `mcp__<uuid>__clickup_*` in the desktop app. Load the tools with **ToolSearch keyword `clickup`** and never hardcode a prefix. Load every tool below in one ToolSearch call.
- **Only the orchestrator writes.** Agents never call `clickup_update_task`, `clickup_create_task`, `clickup_create_comment`, `clickup_add_tag_to_task`, `clickup_attach_task_file` or `clickup_request_attachment_upload`. Under `--dry-run`, log each write as a no-op.
- **Composio:** Composio has no ClickUp connection, so the connector is the path. The one-time "Composio-first" reminder hook can be ignored for ClickUp.
- **Bulk operations:** the server says to prefer `clickup_get_operators` + `clickup_execute_operator` for bulk multi-object operations. On 2026-09-28 `clickup_get_operators` returned `Enabled operators: none`, so use the dedicated tools one call at a time. Re-check operators if a run touches more than 10 tasks.
- Verified live 2026-09-28 against a leaf task, a task with 2 subtasks, and a parent with 40+ subtasks.

## parse_ref

| Input | Rule | id |
|---|---|---|
| `868abc123` | `^[0-9a-z]{6,12}$` with at least one letter | as-is |
| `CU-868abc123` | strip `CU-` (case-insensitive) | `868abc123` |
| `https://app.clickup.com/t/868abc123` | last path segment after `/t/` | `868abc123` |
| `https://app.clickup.com/t/9000000000/868abc123` | `/t/<team digits>/<id>` → last segment | `868abc123` |
| `…/v/cn/<ch>/t/<id>`, `…/chat/r/<ch>/t/<id>` | chat **message** URLs | error: not a task |

Gotchas:
- **Always strip `CU-`.** `clickup_get_task task_id:"CU-868abc123"` fails with `Team not authorized` (verified).
- ClickUp custom task ids (`DEV-1234`) look the same as Linear refs. A bare `ABC-123` is Linear by default. If Linear isn't connected and the workspace uses custom ids, ask the user.

## fetch

Two calls per item:

```
clickup_get_task         { task_id, include: ["description","checklists","attachments","dependencies","linked_tasks","subtasks"], expand_statuses: true }
clickup_get_task_comments{ task_id }
```

- Comments come back newest first. Page with `start` (last comment's `date`) + `start_id` (its `id`) until a page is short.
- If a comment has `reply_count > 0`, call `clickup_get_threaded_comments { comment_id }`. Only do this when replies can carry AC.

| Normalized | Source |
|---|---|
| `tracker` | `"clickup"` |
| `id` | `id` |
| `ref` | `custom_id` if non-null, else `CU-<id>` |
| `url` | `url` |
| `title` | `name` |
| `body` | `markdown_description`. It truncates at 10k chars unless `include` has `description`, which is why `description` is in the call. |
| `acceptance_criteria` | Bullets under the first `Acceptance criteria` heading (`#…` or `**…**`) in `markdown_description`, up to the next heading, bold line or `* * *`. Otherwise every item in `checklists[].items[].name`. Otherwise every `- [ ]` item. Otherwise `[]`. Same rule as `github.md` `def ac`. |
| `status` | `status` (the exact name) |
| `status_type` | classify `status` against `available_statuses` (status_names) |
| `parent` | `parent` (null at the top) |
| `children` | `subtasks[].id` (direct children only) |
| `leaf` | no subtask whose class is outside `done`/`closed` |
| `labels` | `tags[].name`. Also add `type:<task_type>` when `task_type` is non-null (e.g. `type:Bug`). |
| `links.blocked_by` / `links.blocks` | `dependencies[]`: if `.task_id == id`, then `.depends_on` goes in `blocked_by`. If `.depends_on == id`, then `.task_id` goes in `blocks`. The shape is unverified live because every sampled task had `[]`, so inspect the first non-empty result. `linked_tasks` are non-blocking and ignored for ordering. |
| `attachments` | `attachments[]` → `{name: title, url}`, where `url` is the image URL in `markdown_description` that contains the attachment id minus its extension. Verified on `868abc456`: id `802a533f-….png` ↔ `…/802a533f-…/screenshot-….png`. If there's no match, use `url: "clickup-attachment://<task_id>/<attachment_id>"` and resolve it on demand with `clickup_download_task_attachment { task_id, attachment_id }`. That URL is short-lived and single-use, so fetch it once and don't store it. |
| `comments` | `comments[]` → `{author: user.username, body: comment_text}` |
| `repo` | `null`. ClickUp has no repo, so the run uses the cwd repo. |

## children (recursive)

`include: ["subtasks"]` returns **direct** subtasks only. Each one carries `id, name, status, subtasks_count, url`, and `list` is null.

1. Classify each subtask's `status` against the parent's `available_statuses`. If the name isn't there (the subtask lives in another list), call `clickup_get_task { task_id: <sub>, expand_statuses: true }` and classify against its own list.
2. **Actionable** means the class is `open` or `in_progress` (reopened counts as `open`). Run a full fetch on each actionable subtask, and recurse only if its `subtasks_count > 0`.
3. **Skipped** means the class is `review`, `qa`, `done` or `closed`. List it as `{id, title: name, reason: "status <name>"}` and don't recurse.
4. Output a flat `items` array (the root plus actionable descendants) plus `skipped`, the same shape as GitHub `tree.sh`.

Live example: `868abc789` has 40+ subtasks. Most are `released` (closed) or `qa (in prod)` (qa), so they're skipped. Only `868abc000` (`backlog`) is actionable. The parent is not a leaf. `868abc456` has 2 subtasks, both `qa (in prod)`: both are skipped and the item is not a leaf.

## status_names

Valid statuses for a list come from `clickup_get_task { task_id, expand_statuses: true }` → `available_statuses[]`, or from `clickup_get_list { list_id }` → `statuses[]`. Each has `{status, orderindex, type}`, and `type` is one of `open|custom|done|closed`.

Classify a status name with these steps. They are deterministic, so apply them in order:

1. `type: "closed"` → `closed` (e.g. `released`).
   - Then check the name `/will not|won'?t|cannot|can't|duplicate|cancel/i` → `closed`, whatever the type (e.g. `closed - will not resolve`).
2. `type: "done"` → `done`.
3. Name regex, case-insensitive, first match wins:
   - `/reopen/` → `open` (and mark it the reopen target)
   - `/qa|test|verif/` → `qa`
   - `/review/` → `review`
   - `/progress|doing|started/` → `in_progress`
   - `/done|complete|closed|shipped/` → `done`
   - `/todo|to do|open|backlog/` → `open`
4. `type: "open"` → `open`.
5. Otherwise (e.g. `scoping`, `ready`, `paused`, `blocked`, `staged`, `prod (monitor)`), take the class of the nearest classified status with a **lower** `orderindex`. If there is none, the class is `open`.

Example, resolved on a real list:

| orderindex | name | class |
|---|---|---|
| 0–3 | backlog, scoping, refinement, ready | open |
| 4 | in progress | in_progress |
| 5 | reopened (bug) | open (reopen target) |
| 6–8 | in review, paused, blocked | review |
| 9–12 | qa/uat, staged, qa (in prod), prod (monitor) | qa |
| 13–14 | closed - will not resolve, closed - cannot reproduce | closed |
| 15 | done | done |
| 16 | released | closed |

To pick the **target name** for a class:
1. Use the repo override from `<repo>/.claude/do-shit.json` if present. A team whose `main` deploys straight to prod likely wants `qa (in prod)` for post-merge QA.
2. Otherwise, a name exactly equal to the canonical name (`in progress`, `in review`, `qa`, `done`).
3. Otherwise, the lowest-`orderindex` status in that class. For `done`, prefer `type: "done"` and never pick a `closed` class.
4. For reopened, the `/reopen/` name, else the lowest `open`-class status.

Never-backward order: `open < in_progress < review < qa < done`. The harness enforces it (`canMoveStatus`). The only backward move is QA failure → reopened.

## status_write

1. Read the current status with `clickup_get_task { task_id }` (no include needed) and classify it.
2. If `canMoveStatus(from, to)` is false, skip and record `skipped: not ahead (<current>)`.
3. Write with `clickup_update_task { task_id, status: "<exact target name>" }`.
4. If the name is rejected: re-run status_names on `expand_statuses: true`, fuzzy-pick again, and retry once.
5. On any other failure, continue the run. Record `failed: <error>` and report it at the end.

## restore_status

Undo the run's own in_progress move on an item it dropped.

1. Read the current status with `clickup_get_task { task_id }` and classify it.
2. If the class isn't `only_if_type` (`in_progress`), skip and record `skipped: moved since (<current>)`.
3. Write `clickup_update_task { task_id, status: "<to_name>" }`, the exact name from init. No fuzzy pick.
4. On failure, record `failed: <error>` and continue. The harness never retries a restore.

## comment

```
clickup_create_comment { entity_type: "task", entity_id: <id>, comment_text: "<markdown>" }
```

- Markdown is supported. Max 40,000 chars.
- Mentions use the form `[@Name](#user_mention#<numeric id>)` via `clickup_resolve_assignees`. Only mention someone when there's an explicit ask for them.
- `clickup_create_task_comment` is deprecated. Don't use it.
- Text is terse and professional (articles kept, no filler; a user-level "outward-facing writing" rule wins): what changed, why it matters, what's next and from whom. 3–6 lines. Write security and data-loss notes in full prose.

## link_pr

| Marker | Value |
|---|---|
| Branch | `<owner>/CU-<id>-<slug>` (the ClickUp GitHub integration auto-links on `CU-<id>`) |
| PR title | `[CU-<id>] <title>` |
| PR body, first lines | `ClickUp: https://app.clickup.com/t/<id>`, then `Part of CU-<parent> https://app.clickup.com/t/<parent>` if there's a parent |
| Explicit comment | `clickup_create_comment` with the PR URL, a one-paragraph summary, loops used, and outstanding failures on the flagged path |

After the comment, run status_write to `review`.

## create_child (QA bug)

```
clickup_create_task {
  list_id: <item.list.id>, parent: <item id>, name: "Bug: <short>",
  markdown_description: "## Repro\n1. …\n\n## Expected\n…\n\n## Actual\n…\n\n## Evidence\n<attachment names>\n\nFound by /do-shit QA of CU-<item>, env <env>, SHA <sha>.",
  task_type: "Bug", tags: ["bug"]
}
```

- The result's `id` gives the new ref `CU-<id>`. Then run attach for the screenshots on the new task.
- `task_type` must exist in the workspace. If it's rejected, retry without `task_type`.
- `tags` must already exist in the space. If the error names the tag, retry without `tags`.

## attach (screenshots)

| File | Tool |
|---|---|
| Local PNG of any size (normal case) | `clickup_request_attachment_upload { task_id, file_name }`. It returns an upload URL, ticket, HTTP method and multipart field name. Upload exactly as instructed, e.g. `curl -sS -X <method> "<url>" -F "<field>=@/abs/path.png"` plus any returned headers. Untested live, because the call creates an upload ticket. |
| Local file under ~200 KB | `clickup_attach_task_file { task_id, file_name, file_data: "$(base64 -i file.png)" }` (no `data:` prefix) |
| Public http(s) URL | `clickup_attach_task_file { task_id, file_url }` |

- Source dir: `~/.claude/state/do-shit/<repo>--<run-id>/qa/<item>/*.png`.
- After uploading, post one evidence comment. If the upload result returns a file URL, embed it as `![step](url)`. Otherwise list the filenames and say they are attached.

## labels (tags)

```
clickup_add_tag_to_task { task_id, tag_name: "agent-tests-failed" }
```

- The tag must already exist in the task's space. The connector has **no tool to create a space tag**: no dedicated tool, and no enabled operators as of 2026-09-28.
- If the tag is missing, the call fails. Don't retry. Put `agent-tests-failed` as the first line of the PR comment and tell the user in the final report: `create tag "agent-tests-failed" in space <space.id> once`.
