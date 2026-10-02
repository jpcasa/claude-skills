# Tracker adapter: GitHub

- **Purpose:** map GitHub issues (and their sub-issues) to the normalized item, and do every tracker write /do-shit needs.
- **Access:** the `gh` CLI (issues, comments, labels, PRs) plus `gh api graphql` for sub-issues and dependencies. Don't use Composio here, because gh is already authed for every repo in the run.
- **Only the orchestrator writes.** Agents never run the write commands on this page (`gh issue comment|edit|create|close|reopen`, `gh label create`, `gh project item-edit`, GraphQL mutations, `git push`). Under `--dry-run`, log each write as a no-op.
- **One repo per run:** `REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)` from the cwd. Every command passes `-R "$REPO"`.
- Verified live 2026-09-28 against `cli/cli#14529` (6 sub-issues): gh 2.87.3, git 2.53.

## Setup (once per run)

Extract the three code files below into the run's adapter dir. The extraction is mechanical, so don't retype them:

```bash
AD="$HOME/.claude/state/do-shit/<repo>--<run-id>/adapters/github"; mkdir -p "$AD"
awk -v d="$AD" '/^```[a-z]+ file=/{split($2,a,"="); f=d"/"a[2]; next} /^```/{f=""} f{print > f}' \
  "$HOME/.claude/skills/do-shit/references/trackers/github.md"
ls "$AD"   # fetch.graphql  normalize.jq  tree.sh
```

Check the token scopes once: `gh auth status 2>&1 | grep -i 'token scopes'`.
- Without `project` or `read:project`, any `projectItems{project{…}}` field fails with `INSUFFICIENT_SCOPES`. Even then, `gh issue view --json projectItems` returns `[]` silently, so an empty list does **not** prove the issue has no project.
- The fix is a user action: `gh auth refresh -s project`. Never run it yourself. Until it's done, use the label path.

## parse_ref

| Input | Regex | Result |
|---|---|---|
| `#12` or `12` | `^#?(\d+)$` | `$REPO`, number 12 |
| `owner/repo#12` | `^([\w.-]+/[\w.-]+)#(\d+)$` | error unless `$1 == $REPO` |
| `https://github.com/o/r/issues/12` | `^https://github\.com/([\w.-]+/[\w.-]+)/issues/(\d+)` | error unless `$1 == $REPO` |
| `…/pull/12` | — | error: PRs aren't items |

A ref from another repo stops intake with `ref <x> is not in <REPO>` (one repo per run).

## fetch + children

`tree.sh` fetches the root, normalizes it, and walks the actionable children breadth-first. It prints `{items:[…normalized…], skipped:[{id,title,reason}]}`. Pass `items` to `harness init` and list `skipped` in the intake summary.

```bash
bash "$AD/tree.sh" "$REPO" 12 "$AD" > "$AD/tree-12.json"
jq '{n:(.items|length), leaves:[.items[]|select(.leaf)|.ref], skipped}' "$AD/tree-12.json"
```

What counts as a child:
- **Actionable child:** `OPEN`, same repo, and no `status:in-review` or `status:qa` label. Only these are fetched and recursed into.
- **Skipped child:** listed with a reason and not recursed into. A child is skipped when it is closed (`closed (COMPLETED|NOT_PLANNED|DUPLICATE)`), in another repo (`other repo o/r`), or already past build (`already status:in-review`).
- **`leaf`:** true when the item has no `OPEN` sub-issues. A parent whose open children are all skipped is not a leaf and produces no work, so report it and don't build it.
- **`children`:** all direct sub-issue ids, open or closed.
- **Ids:** same-repo ids are the bare number as a string (`"12"`). Cross-repo ids are `o/r#12`.

Confirmed GraphQL field names (they work without the `GraphQL-Features: sub_issues` header, and results are identical with it):
- `Issue.subIssues(first:)`, `Issue.parent`, `Issue.subIssuesSummary{total completed percentCompleted}`
- `Issue.blockedBy(first:)`, `Issue.blocking(first:)`, `Issue.issueDependenciesSummary{blockedBy blocking totalBlockedBy totalBlocking}`
- Mutations: `addSubIssue(input:{issueId, subIssueId|subIssueUrl, replaceParent})`, `removeSubIssue`, `reprioritizeSubIssue`, `addBlockedBy(input:{issueId, blockingIssueId})`, `removeBlockedBy`
- `trackedIssues` and `trackedInIssues` are the legacy task-list links. Ignore them.

```graphql file=fetch.graphql
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){
      id number title url state stateReason body
      repository{nameWithOwner}
      labels(first:50){nodes{name}}
      parent{number url state repository{nameWithOwner}}
      subIssuesSummary{total completed}
      subIssues(first:100){nodes{number title state stateReason url repository{nameWithOwner} labels(first:20){nodes{name}}}}
      blockedBy(first:50){nodes{number url state repository{nameWithOwner}}}
      blocking(first:50){nodes{number url state repository{nameWithOwner}}}
      comments(first:100){nodes{author{login} body}}
    }
  }
}
```

```jq file=normalize.jq
def ac:
  (. // "" | split("\n")) as $L
  | ([range(0; $L|length) | select($L[.] | test("^\\s*(#{1,6}\\s*|\\*\\*)acceptance criteria"; "i"))] | first) as $i
  | def item: capture("^\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[[ xX]\\]\\s+)?(?<t>.+?)\\s*$").t;
    if $i != null then
      [ $L[($i+1):] | (map(test("^\\s*(#{1,6}\\s|\\*\\*[^*]+\\*\\*\\s*$|(\\* \\* \\*|---|___)\\s*$)")) | index(true)) as $end
        | (if $end == null then . else .[:$end] end)[] | select(test("^\\s*(?:[-*+]|\\d+[.)])\\s+")) | item ]
    else
      [ $L[] | select(test("^\\s*[-*+]\\s+\\[[ xX]\\]\\s+")) | item ]
    end;
def attachments:
  [ .[] // "" | (
      (scan("!?\\[([^\\]\\n]{0,200})\\]\\((https://(?:github\\.com/user-attachments|(?:private-)?user-images\\.githubusercontent\\.com)[^)\\s]+)\\)") | {name: (if .[0] == "" then (.[1]|split("/")|last) else .[0] end), url: .[1]}),
      (scan("<img[^>]*src=\"(https://(?:github\\.com/user-attachments|(?:private-)?user-images\\.githubusercontent\\.com)[^\"]+)\"") | {name: (.[0]|split("/")|last), url: .[0]})
    ) ] | unique_by(.url);
def stype($labels):
  if .state == "CLOSED" then
    (if ($labels | index("status:qa")) then "qa" elif .stateReason == "COMPLETED" then "done" else "closed" end)
  elif ($labels | index("status:qa")) then "qa"
  elif ($labels | index("status:in-review")) then "review"
  elif ($labels | index("status:in-progress")) then "in_progress"
  else "open" end;
.data.repository.issue as $i
| ($i.repository.nameWithOwner) as $repo
| [$i.labels.nodes[].name] as $labels
| def rid($r): if $r.repository.nameWithOwner == $repo then ($r.number|tostring) else "\($r.repository.nameWithOwner)#\($r.number)" end;
{ tracker: "github",
  id: ($i.number|tostring),
  ref: "#\($i.number)",
  url: $i.url,
  title: $i.title,
  body: ($i.body // ""),
  acceptance_criteria: ($i.body | ac),
  status: ($i | if .state == "CLOSED" then "closed:\(.stateReason // "")" else ([$labels[] | select(startswith("status:"))] | first // "open") end),
  status_type: ($i | stype($labels)),
  parent: (if $i.parent then rid($i.parent) else null end),
  children: [$i.subIssues.nodes[] | rid(.)],
  leaf: ([$i.subIssues.nodes[] | select(.state == "OPEN")] | length == 0),
  labels: $labels,
  links: { blocks: [$i.blocking.nodes[] | rid(.)], blocked_by: [$i.blockedBy.nodes[] | rid(.)] },
  attachments: ([$i.body] + [$i.comments.nodes[].body] | attachments),
  comments: [$i.comments.nodes[] | {author: (.author.login // "ghost"), body}],
  repo: $repo,
  child_states: [$i.subIssues.nodes[] | ([.labels.nodes[].name] | map(select(. == "status:in-review" or . == "status:qa")) | first) as $past
    | {id: rid(.), title,
       reason: (if .repository.nameWithOwner != $repo then "other repo \(.repository.nameWithOwner)"
                elif .state == "CLOSED" then "closed (\(.stateReason // "unknown"))"
                elif $past then "already \($past)" else null end)}
    | .actionable = (.reason == null)]
}
```

```bash file=tree.sh
set -uo pipefail
# usage: bash tree.sh OWNER/NAME ROOT_NUMBER ADAPTER_DIR  -> {items, skipped}
REPO=$1; ROOT=$2; AD=$3
OWNER=${REPO%/*}; NAME=${REPO#*/}
items='[]'; skipped='[]'; queue=("$ROOT")
while ((${#queue[@]})); do
  num=${queue[0]}; queue=("${queue[@]:1}")
  if ! item=$(gh api graphql -F owner="$OWNER" -F name="$NAME" -F number="$num" -f query="$(cat "$AD/fetch.graphql")" | jq -c -f "$AD/normalize.jq"); then
    skipped=$(jq -c --arg id "$num" '. + [{id:$id, title:null, reason:"fetch failed"}]' <<<"$skipped"); continue
  fi
  items=$(jq -c --argjson i "$item" '. + [$i | del(.child_states)]' <<<"$items")
  skipped=$(jq -c --argjson i "$item" '. + [$i.child_states[] | select(.actionable | not) | {id, title, reason}]' <<<"$skipped")
  for c in $(jq -r '.child_states[] | select(.actionable) | .id' <<<"$item"); do queue+=("$c"); done
done
jq -n --argjson items "$items" --argjson skipped "$skipped" '{items:$items, skipped:$skipped}'
```

How the normalized fields are derived:

| Field | Source |
|---|---|
| `id` / `ref` | `number` → `"12"` / `"#12"` |
| `body` | `body` (markdown) |
| `acceptance_criteria` | Bullets under the first `Acceptance criteria` heading or bold line, up to the next heading, bold line or rule. Otherwise every `- [ ]`/`- [x]` task-list item in the body. Otherwise `[]`. |
| `status` / `status_type` | See status_names |
| `parent` / `children` | `parent`, `subIssues` |
| `links` | `blocking` → `blocks`, `blockedBy` → `blocked_by` |
| `attachments` | `user-attachments` / `user-images` URLs found in the body and comments (markdown and `<img src>`). GitHub has no attachment objects. |
| `comments` | First 100. Past 100, page with `comments(first:100, after:$cursor)` and `pageInfo{hasNextPage endCursor}`. |
| `repo` | `repository.nameWithOwner` |

Gotchas:
- The shell is zsh, so always run `tree.sh` with `bash`.
- `subIssues(first:100)`: if `subIssuesSummary.total` is over 100, page with `after:`.
- GitHub has no native AC or checklist field. Everything comes from the markdown.

## status_names

GitHub issues only have `OPEN`/`CLOSED`, plus `stateReason` (`COMPLETED`, `NOT_PLANNED`, `DUPLICATE`, `REOPENED`). Pick one status carrier per run and record it in `run.json`.

1. **Projects v2 Status field** if the token has `project` scope **and** the issue is in exactly one project with a single-select `Status` field. The query is untested live because the token lacks the scope:
   ```bash
   gh api graphql -F owner=O -F name=R -F number=N -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){projectItems(first:10){nodes{id project{id title} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name optionId field{... on ProjectV2SingleSelectField{id options{id name}}}}}}}}}}'
   ```
   The valid statuses are `field.options[].name`. Fuzzy-match them (below) and keep `{project.id, item.id, field.id, option.id}` for writes.
2. **Otherwise use labels**: `status:in-progress`, `status:in-review`, `status:qa`. No `status:` label means `open`.

Map to a status class with these regexes, case-insensitive, first match wins:

| Class | Regex | Label (label path) |
|---|---|---|
| reopened | `reopen\|todo\|to do\|open\|backlog` | none (remove `status:*`, `gh issue reopen`) |
| in_progress | `progress\|doing\|started` | `status:in-progress` |
| review | `review` | `status:in-review` |
| qa | `qa\|test\|verif` | `status:qa` |
| done | `done\|complete\|closed\|shipped` | none (issue closed) |

- Order for never-backward: `open < in_progress < review < qa < done`.
- `closed` (`NOT_PLANNED`/`DUPLICATE`) sits outside the order and never moves.
- The one sanctioned backward move is QA failure → reopened. It's allowed only from `qa`/`done` (`policy.canMoveStatus`).
- If Project options overlap (e.g. `QA` and `Verified`), prefer an exact class name, then the option listed first.

Closing works like this:
- `done` happens only through the PR's `Closes #N` on merge. Never `gh issue close` a leaf by hand.
- Closing keywords only fire when the PR's base is the default branch. A stacked PR retargeted before merge is fine. A PR merged into a non-default base leaves the issue open, so report it.
- QA after merge: the issue is already closed. Add `status:qa` to the closed issue. `normalize.jq` reads closed + `status:qa` as `qa`. Removing the label on QA pass makes it `done`.
- A parent umbrella is closed by the orchestrator once every leaf is `done`: `gh issue close P -R "$REPO" --reason completed`.
- Projects v2 built-in workflows can also set Status on close or PR link. Read before every write.

## status_write

1. Re-read the current status with `tree.sh` on that one number, or `gh issue view N -R "$REPO" --json state,stateReason,labels`, and classify it.
2. Ask the harness whether the move is allowed (`canMoveStatus(from,to)`). If not, skip and record `skipped: not ahead`.
3. Write:
   - Label path. Ensure the label exists first (see labels), then:
     `gh issue edit N -R "$REPO" --add-label status:in-review --remove-label status:in-progress`
     Remove every other `status:*` label present.
   - Project path: `gh project item-edit --id <item.id> --project-id <project.id> --field-id <field.id> --single-select-option-id <option.id>`
   - Reopen after QA failure: `gh issue reopen N -R "$REPO"`, then remove the `status:*` labels.
4. On failure (missing scope, label, or option), don't stop the run. Record `failed: <stderr first line>` and report it at the end.

## restore_status

Undo the run's own in_progress move on an item it dropped.

1. Re-read and classify. If the class isn't `only_if_type` (`in_progress`), skip and record `skipped: moved since`.
2. Label path: remove `status:in-progress`. If `to_name` is itself a `status:*` label, add it back. Project path: set the option whose name equals `to_name`.
3. On failure, record `failed: <stderr first line>` and continue. The harness never retries a restore.

## comment

```bash
gh issue comment N -R "$REPO" --body-file "$AD/comment-N.md"
```
- Always use `--body-file`. Inline `--body` breaks on backticks and `$`.
- Text is terse and professional (articles kept, no filler; a user-level "outward-facing writing" rule wins): what changed, why it matters, what's next and from whom. 3–6 lines. Keep exact strings, paths and URLs.
- Write security and data-loss notes in full prose.

## link_pr

| Marker | Value |
|---|---|
| Branch | `<owner>/<N>-<slug>` (e.g. `jpcasa/12-fix-login`) |
| PR title | `[#12] <title>` |
| PR body, first lines | `Closes #12`, then `Part of #<parent>` if there's a parent. Never write `Closes #<parent>`. |
| Explicit comment | `gh issue comment 12 --body-file …` with the PR URL and a one-line summary |

- `Closes #N` links the PR in the issue's Development panel and closes it on merge.
- For a cross-repo child (normally skipped), use `Closes o/r#N`.
- The PR is created by the orchestrator:
  `gh pr create -R "$REPO" --base <base> --head <branch> --title "[#12] …" --body-file …`
  Add `--draft --label agent-tests-failed` on the flagged path.

## create_child (QA bug)

```bash
URL=$(gh issue create -R "$REPO" --title "Bug: <short>" --label bug --body-file "$AD/bug.md")   # prints the issue URL
PID=$(gh api graphql -F owner=O -F name=R -F number=<parent> -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id}}}' -q .data.repository.issue.id)
gh api graphql -f p="$PID" -f u="$URL" -f query='mutation($p:ID!,$u:String!){addSubIssue(input:{issueId:$p,subIssueUrl:$u}){subIssue{number url}}}'
```

- `bug.md` sections: `Repro` (numbered steps), `Expected`, `Actual`, `Evidence` (image links from attach), and `Found by /do-shit QA of #<item>, env <env>, SHA <sha>`.
- The parent is the item that failed QA.
- The new ref is `#${URL##*/}`.
- `gh issue create` has no `--parent` flag in 2.87, so the `addSubIssue` mutation is required.
- If the `bug` label is missing, create it first (see labels).

## attach (screenshots → orphan `qa-evidence` branch)

GitHub has no API for uploading images into comments, so evidence goes on an orphan branch in the same repo and is embedded by blob URL.

```bash
MAIN=$(git rev-parse --show-toplevel)
EV="$MAIN/.claude/worktrees/qa-evidence"
if git -C "$MAIN" ls-remote --exit-code --heads origin qa-evidence >/dev/null; then
  git -C "$MAIN" fetch origin qa-evidence
  git -C "$MAIN" worktree add -B qa-evidence "$EV" origin/qa-evidence
else
  git -C "$MAIN" worktree add --orphan -b qa-evidence "$EV"      # git >= 2.42; starts empty
  # older git: git -C "$MAIN" worktree add --detach "$EV" && git -C "$EV" checkout --orphan qa-evidence && git -C "$EV" rm -rf --quiet .
fi
mkdir -p "$EV/<run-id>/<item>"
cp ~/.claude/state/do-shit/<repo>--<run-id>/qa/<item>/*.png "$EV/<run-id>/<item>/"
git -C "$EV" add "<run-id>/<item>"
git -C "$EV" commit -m "qa evidence <run-id> <item>"
git -C "$EV" push -u origin qa-evidence                           # orchestrator only
git -C "$MAIN" worktree remove "$EV"
```

- Embed in the evidence comment:
  `![<step>](https://github.com/<owner>/<repo>/blob/qa-evidence/<run-id>/<item>/<file>.png?raw=true)`
- On private repos this renders only for viewers with repo access, which is expected.
- `<item>` is the bare number.
- Never force-push `qa-evidence`. It's append-only.
- If a ruleset blocks creating the branch, report it and post the comment without images, listing the local paths.

## labels

```bash
ensure_label() { gh label list -R "$REPO" --search "$1" --json name -q '.[].name' | grep -qxF "$1" \
  || gh label create "$1" -R "$REPO" --color "$2" --description "$3"; }
ensure_label agent-tests-failed B60205 "do-shit: tests did not pass within the loop cap"
ensure_label status:in-progress FBCA04 "do-shit status"
ensure_label status:in-review 5319E7 "do-shit status"
ensure_label status:qa 0E8A16 "do-shit status"
ensure_label bug D73A4A "Something isn't working"
gh issue edit N -R "$REPO" --add-label agent-tests-failed      # or: gh pr edit <pr> --add-label …
```

- Check before creating. `gh label create --force` would overwrite an existing label's color and description.
