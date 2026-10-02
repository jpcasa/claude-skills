---
name: changelog
description: "Build a release changelog from the last N releases (production promotion PRs or git tags), written for a chosen audience (technical or non-technical). Resolves every PR each release carried, summarises what it fixed or added, links its tracker ticket (GitHub Issues, ClickUp, Linear, or another tracker with an MCP connector), and closes with an 'In progress' section of recently opened tickets. Use when the user invokes /changelog, asks what shipped, or asks to set up changelog tracking for a repo."
argument-hint: "[technical | non-technical] [--releases N] [--days N] | setup"
---

# Changelog

Turn the last releases into something a person can read. One audience per run: the same facts, pitched differently.

```
Config ──► Audience ──► Resolve releases ──► Per-PR summary ──► Tracker: recent tickets
                                                                         │
                                         ◄──── CHANGELOG ────────────────┘
```

**This skill is read-only.** It never merges, promotes, tags, or writes to a tracker. The only file it writes is the changelog itself (and `.claude/changelog.json` during setup).

```
S="${CLAUDE_PLUGIN_ROOT}/skills/changelog"
```

## Phase 0 — Config

Settings live in `<repo>/.claude/changelog.json`. See [config.example.json](config.example.json).

- `$ARGUMENTS` is `setup`, or the file is missing: run [references/setup.md](references/setup.md) first, then continue. Setup asks which tracker the repo uses.
- Otherwise read the file. Load the tracker adapter named by `tracker.type`: `references/trackers/<type>.md` (`github`, `clickup`, `linear`, `other`). `none` means PRs only, no ticket links and no In-progress section.

## Phase 1 — Audience

`$ARGUMENTS` may already carry the audience. If it does not, ask with AskUserQuestion, exactly two options:

- **Technical**: engineers. PR numbers, root causes, migrations, feature flags.
- **Non-technical**: ops, support, leadership. What changed for the people using the product.

Do not guess, and do not write both. The audience changes the prose, never the facts: a migration or a default-on behaviour change is called out in **both** registers.

Optional flags: `--releases N` (default 2; `--promotions N` is an alias), `--days N` for the in-progress window (default `in_progress_days` from config, else 3).

## Phase 2 — Resolve the releases

```bash
bash "$S/scripts/release-ranges.sh" --count 2
```

The script reads `.claude/changelog.json` itself. It emits, newest first:

```
RELEASE <id> <date> <sha8> <title>      id = promotion PR number, or tag
RANGE <from_sha>..<to_sha>
PR <number>
...
END
```

How it decides:

- **promotion** mode: a release is a merged PR whose base is the production branch. Its payload is every PR merged into the main branch between the previous promotion's merge commit and its own. Promotion PRs themselves are filtered out.
- **tags** mode: a release is a tag matching `tag_pattern`. Its payload is every PR merged into the main branch between the previous matching tag and this one.

`PR` lines come from commit subjects in the range plus merged PRs whose GitHub merge commit sits inside it, never from commit bodies (bodies cite unrelated PRs). `scripts/test/release-ranges.test.sh` pins that.

Do not identify promotions by title. Titles drift; the base branch does not.

If the script errors on missing objects, the clone lacks history. Run the command the error prints (`git fetch origin <branch> --unshallow` or `git fetch --tags --unshallow origin`).

## Phase 3 — Summarise each PR

Per PR number:

```bash
gh pr view <n> --repo <repo> \
  --json number,title,body,headRefName,author,mergedAt,url,files,labels
```

Write **one or two sentences**: what was wrong or missing, and what the change does about it. Read the PR body. It often states the real root cause, which may not be what the ticket title claims. Prefer the body's account over the title.

Flag explicitly, in either audience:

- **Database migrations**: name the file and say whether it is additive (new nullable columns, no backfill) or touches existing rows.
- **Default-on behaviour changes**: anything that alters live behaviour without someone opting in.
- **Docs-only PRs**: say there is nothing to test.

### Resolving the ticket

Follow the adapter's **Ticket ID** section. The precedence is the same for every tracker:

1. An ID in the **branch name** is the PR's own ticket. It wins.
2. Otherwise the first ID in the body, if the body presents it as _the_ ticket ("Fixes …", "Closes …", "<Tracker>: …").
3. Bodies often cite several IDs as related or superseded work. Those are **not** the PR's ticket.

**Many PRs have no ticket.** Write "no ticket linked" and move on. Never attach a plausible-looking ticket you found by searching. A wrong link is worse than no link, because a reader will act on it.

## Phase 4 — In progress

Tickets opened in the last `--days`, with their current status. Follow the adapter's **In progress** section, read-only calls only.

**Call budget: 6 tracker calls per run.** Rate limits are often shared session-wide, and overspending here surfaces later as a confusing failure in an unrelated task. Scope every query; never enumerate a whole workspace.

Report each as: title, status, assignee, link. Group by status so the section reads as a state of play, not a dump. Exclude tickets already shipped in the releases above.

If the tracker is unavailable, unauthenticated, or rate-limited: **say so in the output** and render the changelog without the section. Never present an empty list as "nothing in flight" when the lookup failed.

## Phase 5 — Render

Both audiences get the same skeleton:

```markdown
# What shipped

## <date> — <release: "promotion #<pr>" or the tag>

<entries>

## <date> — <release>

<entries>

## In progress

<grouped by status>
```

**Technical.** Keep PR numbers and ticket IDs inline. Name the root cause. State migrations by filename, flags by name. Assume the reader will open the PR.

**Non-technical.** Lead with the effect on the people using the product: "support agents couldn't refund a partially shipped order; they can now." Keep the links, drop the internals from the prose. No PR numbers mid-sentence, no file paths, no flag names. If a change is invisible to users, say that plainly rather than inflating it.

Rules for both:

- Group by area, not by PR order. Use `areas` from config when set; otherwise infer a short list from labels and changed paths. Readers scan by area.
- One or two sentences per entry. This is a changelog, not the PR body.
- Never claim something is verified or QA'd unless you checked. "Shipped" and "working" are different words.
- State the release date in the reader's terms, not a SHA.

## Phase 6 — Deliver

Write to a file and hand over the path. These get pasted into chat channels and outlive the session:

```
<output_dir, default docs/changelogs>/<YYYY-MM-DD>-changelog.md
```

Offer to publish it as a shareable page if the host supports one.

Register: no filler, no hedging, complete sentences. The repo's own writing conventions win if it has them.

## Guardrails

- Read-only. No merges, promotions, tags, or tracker writes.
- Never invent a ticket link or a PR summary. Unlinked and unsummarised are acceptable outputs; wrong ones are not.
- Never state that a release was QA'd or verified unless that was actually checked.
- A failed tracker lookup is reported, not silently rendered as "nothing in progress".
