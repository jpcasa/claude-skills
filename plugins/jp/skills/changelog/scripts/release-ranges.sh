#!/usr/bin/env bash
# Resolve the last N releases and the PRs each one carried.
#
# Two release models:
#   promotion  A release is a merged PR into the production branch. Its payload
#              is every PR merged into the main branch between the previous
#              promotion's merge commit and its own. Promotion PRs themselves
#              (base staging, base production) are filtered out.
#   tags       A release is a git tag matching a pattern (GitHub releases are
#              tags too). Its payload is every PR merged into the main branch
#              between the previous matching tag and this one.
#
# How a PR is attributed to a release (see test/release-ranges.test.sh):
#   1. Commit *subjects* inside the range that GitHub writes when it merges a
#      PR: "Merge pull request #N from ..." and squash-style "... (#N)".
#      Subjects only. Bodies cite other PRs ("Follow-up to #87", "defect #2")
#      that are not part of the payload; scanning bodies over-attributes.
#   2. Merged PRs into the main branch whose GitHub merge commit lies inside
#      the range. This catches PRs GitHub marks merged through another PR's
#      merge commit, which have no subject of their own.
#   Every candidate is then kept only if its base is the main branch.
#
# Settings come from flags, else <repo>/.claude/changelog.json, else defaults:
#   --count N               releases to emit (default 2)
#   --mode promotion|tags   default: promotion if origin has the production branch, else tags
#   --repo owner/name       default: gh repo view
#   --main-branch B         default: the repo's default branch
#   --production-branch B   default: production
#   --tag-pattern P         default: v*
#   --config PATH           default: <toplevel>/.claude/changelog.json
#
# Output, newest first, one block per release:
#   RELEASE <id> <date> <sha8> <title>      id is the PR number or the tag
#   RANGE <from_sha8>..<to_sha8>
#   PR <number>
#   ...
#   END
set -euo pipefail

REPO="" MAIN="" PROD="" PATTERN="" MODE="" COUNT="" CONFIG=""

# PR numbers named by commit subjects in prev..cur, one per line, unsorted.
subject_pr_candidates() {
  local prev="$1" cur="$2"
  git log --format='%s' "${prev}..${cur}" \
    | { grep -oE '^Merge pull request #[0-9]+|\(#[0-9]+\)$' || true; } \
    | { grep -oE '[0-9]+' || true; }
}

# Lazily fetched once: "<merge_sha> <number>" for recent merged PRs into MAIN.
main_prs_index=""
main_prs_index_loaded=0
load_main_prs_index() {
  [ "$main_prs_index_loaded" -eq 1 ] && return 0
  main_prs_index=$(gh pr list --repo "$REPO" --base "$MAIN" --state merged --limit 500 \
    --json number,mergeCommit 2>/dev/null \
    | jq -r '.[] | select(.mergeCommit.oid != null) | "\(.mergeCommit.oid) \(.number)"' 2>/dev/null || true)
  main_prs_index_loaded=1
}

# PRs into MAIN whose GitHub merge commit is a commit inside prev..cur.
merge_commit_pr_candidates() {
  local prev="$1" cur="$2"
  load_main_prs_index
  [ -n "$main_prs_index" ] || return 0
  awk 'NR==FNR { inrange[$1] = 1; next } ($1 in inrange) { print $2 }' \
    <(git rev-list "${prev}..${cur}") \
    <(printf '%s\n' "$main_prs_index")
}

# The PRs into MAIN a release carried: union of both candidate sources,
# filtered to base MAIN, numerically sorted, one number per line.
main_prs_in_range() {
  local prev="$1" cur="$2"
  local from_merge_commits n base
  from_merge_commits=$(merge_commit_pr_candidates "$prev" "$cur")
  {
    printf '%s\n' "$from_merge_commits"
    for n in $(subject_pr_candidates "$prev" "$cur" | sort -un); do
      grep -qx "$n" <<< "$from_merge_commits" && continue
      base=$(gh pr view "$n" --repo "$REPO" --json baseRefName 2>/dev/null | jq -r '.baseRefName // ""' 2>/dev/null || echo '')
      # Other bases are promotion PRs; empty means the number was not a PR.
      if [ "$base" = "$MAIN" ]; then
        printf '%s\n' "$n"
      fi
    done
  } | { grep -E '^[0-9]+$' || true; } | sort -un
}

die() { echo "$*" >&2; exit 1; }

need_commits() {
  local a="$1" b="$2" hint="$3"
  if ! git cat-file -e "${a}^{commit}" 2>/dev/null || ! git cat-file -e "${b}^{commit}" 2>/dev/null; then
    die "Commit range ${a}..${b} is not present locally. Run: ${hint}"
  fi
}

emit() {
  local id="$1" date="$2" prev="$3" cur="$4" title="$5" n
  printf 'RELEASE %s %s %s %s\n' "$id" "$date" "${cur:0:8}" "$title"
  printf 'RANGE %s..%s\n' "${prev:0:8}" "${cur:0:8}"
  for n in $(main_prs_in_range "$prev" "$cur"); do
    printf 'PR %s\n' "$n"
  done
  printf 'END\n'
}

promotion_releases() {
  local want=$((COUNT + 1)) promos total i cur prev cur_sha prev_sha
  # gh lists by creation date; sort by merge time and keep the newest.
  promos=$(gh pr list --repo "$REPO" --base "$PROD" --state merged --limit $((want * 3 + 10)) \
    --json number,title,mergedAt,mergeCommit \
    | jq -c --argjson n "$want" '[.[] | select(.mergeCommit.oid != null)] | sort_by(.mergedAt) | reverse | .[:$n]')
  total=$(jq 'length' <<< "$promos")
  [ "$total" -ge 2 ] || die "Need at least 2 merged PRs into '${PROD}' to build a range; found ${total}."
  git fetch --no-tags origin "+refs/heads/${PROD}:refs/remotes/origin/${PROD}" >/dev/null 2>&1 || true
  for i in $(seq 0 $((total - 2))); do
    cur=$(jq -c ".[$i]" <<< "$promos")
    prev=$(jq -c ".[$((i + 1))]" <<< "$promos")
    cur_sha=$(jq -r '.mergeCommit.oid' <<< "$cur")
    prev_sha=$(jq -r '.mergeCommit.oid' <<< "$prev")
    need_commits "$prev_sha" "$cur_sha" "git fetch origin ${PROD} --unshallow"
    emit "$(jq -r '.number' <<< "$cur")" "$(jq -r '.mergedAt' <<< "$cur")" "$prev_sha" "$cur_sha" "$(jq -r '.title' <<< "$cur")"
  done
}

tag_releases() {
  local want=$((COUNT + 1)) tags total i cur prev cur_sha prev_sha
  git fetch --tags origin >/dev/null 2>&1 || true
  tags=$(git tag --list "$PATTERN" --sort=-creatordate | head -n "$want")
  total=$(grep -c . <<< "$tags" || true)
  [ "$total" -ge 2 ] || die "Need at least 2 tags matching '${PATTERN}' to build a range; found ${total}."
  for i in $(seq 1 $((total - 1))); do
    cur=$(sed -n "${i}p" <<< "$tags")
    prev=$(sed -n "$((i + 1))p" <<< "$tags")
    cur_sha=$(git rev-parse "${cur}^{commit}")
    prev_sha=$(git rev-parse "${prev}^{commit}")
    need_commits "$prev_sha" "$cur_sha" "git fetch --tags --unshallow origin"
    emit "$cur" "$(git log -1 --format=%cI "$cur_sha")" "$prev_sha" "$cur_sha" "$cur"
  done
}

load_settings() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --count) COUNT="$2"; shift 2 ;;
      --mode) MODE="$2"; shift 2 ;;
      --repo) REPO="$2"; shift 2 ;;
      --main-branch) MAIN="$2"; shift 2 ;;
      --production-branch) PROD="$2"; shift 2 ;;
      --tag-pattern) PATTERN="$2"; shift 2 ;;
      --config) CONFIG="$2"; shift 2 ;;
      [0-9]*) COUNT="$1"; shift ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  CONFIG="${CONFIG:-$(git rev-parse --show-toplevel)/.claude/changelog.json}"
  cfg_val() { [ -f "$CONFIG" ] && jq -r "$1 // empty" "$CONFIG" || true; }
  REPO="${REPO:-$(cfg_val .repo)}"
  MAIN="${MAIN:-$(cfg_val .release.main_branch)}"
  PROD="${PROD:-$(cfg_val .release.production_branch)}"
  PATTERN="${PATTERN:-$(cfg_val .release.tag_pattern)}"
  MODE="${MODE:-$(cfg_val .release.mode)}"
  COUNT="${COUNT:-2}"
  PROD="${PROD:-production}"
  PATTERN="${PATTERN:-v*}"
  [ -n "$REPO" ] || REPO=$(gh repo view --json nameWithOwner | jq -r .nameWithOwner)
  [ -n "$MAIN" ] || MAIN=$(gh repo view "$REPO" --json defaultBranchRef | jq -r .defaultBranchRef.name)
  if [ -z "$MODE" ]; then
    if git ls-remote --exit-code --heads origin "$PROD" >/dev/null 2>&1; then MODE=promotion; else MODE=tags; fi
  fi
  [[ "$COUNT" =~ ^[0-9]+$ ]] && [ "$COUNT" -ge 1 ] || die "count must be a positive integer; got '${COUNT}'"
}

# When sourced (by the test), expose the functions and stop here.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

load_settings "$@"
case "$MODE" in
  promotion) promotion_releases ;;
  tags) tag_releases ;;
  *) die "mode must be promotion or tags; got '${MODE}'" ;;
esac
