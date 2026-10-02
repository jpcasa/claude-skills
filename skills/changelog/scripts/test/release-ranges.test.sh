#!/usr/bin/env bash
# Offline regression test for release-ranges.sh: a synthetic git repo plus a
# stub `gh` on PATH. No network, no real repo.
#
# History (oldest first), with the GitHub PR each commit belongs to:
#   c0  init                                  release v1 / promotion #10
#   c1  feat: a (#1)                          base main
#   c2  fix: b (#2), body "Follow-up to #99"  base main; #99 shipped before c0
#   c3  Merge pull request #11 from o/staging base staging (a promotion layer)
#   c4  chore: c                              #3 merged via this commit, no number in subject
#                                             release v2 / promotion #12
#   c5  feat: d (#4)                          release v3 / promotion #13
# Expected: newest release carries #4; the one before carries #1 #2 #3.
# #11 (wrong base) and #99 (named only in a body) must never appear.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="${here}/../release-ranges.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"; stub="$tmp/stub"; mkdir -p "$repo" "$stub/bin"
git -C "$repo" init -q -b main
commit() { # <n> <subject> [body]
  GIT_AUTHOR_DATE="2026-01-0$1T00:00:00Z" GIT_COMMITTER_DATE="2026-01-0$1T00:00:00Z" \
    git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$2" ${3:+-m "$3"}
  git -C "$repo" rev-parse HEAD
}
c0=$(commit 1 "init")
c1=$(commit 2 "feat: a (#1)")
c2=$(commit 3 "fix: b (#2)" "Follow-up to #99")
c3=$(commit 4 "Merge pull request #11 from o/staging")
c4=$(commit 5 "chore: c")
c5=$(commit 6 "feat: d (#4)")
for t in "v1 $c0" "v2 $c4" "v3 $c5"; do git -C "$repo" tag $t; done

# gh stub: serves canned JSON, ignores --jq-style flags it doesn't need.
cat > "$stub/promos.json" <<J
[{"number":13,"title":"Promote 3","mergedAt":"2026-01-06T00:00:00Z","mergeCommit":{"oid":"$c5"}},
 {"number":10,"title":"Promote 1","mergedAt":"2026-01-01T00:00:00Z","mergeCommit":{"oid":"$c0"}},
 {"number":12,"title":"Promote 2","mergedAt":"2026-01-05T00:00:00Z","mergeCommit":{"oid":"$c4"}}]
J
cat > "$stub/main.json" <<J
[{"number":1,"mergeCommit":{"oid":"$c1"}},{"number":2,"mergeCommit":{"oid":"$c2"}},
 {"number":3,"mergeCommit":{"oid":"$c4"}},{"number":4,"mergeCommit":{"oid":"$c5"}},
 {"number":99,"mergeCommit":{"oid":"$c0"}}]
J
mkdir -p "$stub/bases"
for n in 1 2 3 4 99; do echo main > "$stub/bases/$n"; done
echo staging > "$stub/bases/11"
for n in 10 12 13; do echo production > "$stub/bases/$n"; done
cat > "$stub/bin/gh" <<'G'
#!/usr/bin/env bash
args=" $* "
case "$args" in
  *" pr list "*"--base production "*) cat "$STUB/promos.json" ;;
  *" pr list "*"--base main "*) cat "$STUB/main.json" ;;
  *" pr view "*) n=$(awk '{print $3}' <<< "$*"); [ -f "$STUB/bases/$n" ] && printf '{"baseRefName":"%s"}\n' "$(cat "$STUB/bases/$n")" || exit 1 ;;
  *) echo "gh stub: unhandled: $*" >&2; exit 1 ;;
esac
G
chmod +x "$stub/bin/gh"
export STUB="$stub" PATH="$stub/bin:$PATH"

fail=0
check() { if [ "$1" -eq 0 ]; then printf 'ok   - %s\n' "$2"; else printf 'FAIL - %s\n' "$2"; fail=1; fi; }
prs_by_release() { grep -E '^(RELEASE|PR)' | awk '/^RELEASE/{if(r)print r; r=$2":"; next} {r=r" "$2} END{print r}'; }

cd "$repo"
common=(--repo o/r --main-branch main --config /dev/null)

# 1. Subject scan never names PRs cited only in bodies.
# shellcheck source=../release-ranges.sh
( source "$script"; subject_pr_candidates "$c0" "$c4" | sort -un | tr '\n' ' ' ) > "$tmp/subjects"
! grep -qw 99 "$tmp/subjects"
check $? "subject scan ignores #99 named only in a body"

# 2. Promotion mode.
out=$(bash "$script" "${common[@]}" --mode promotion --production-branch production --count 2 2>&1)
check $? "promotion mode exits 0"
got=$(prs_by_release <<< "$out")
want=$'13: 4\n12: 1 2 3'
[ "$got" = "$want" ]
check $? "promotion mode: #13 -> 4; #12 -> 1 2 3 (no #11, no #99)"
[ "$got" = "$want" ] || printf '  want: %q\n  got:  %q\n' "$want" "$got"

# 3. Tags mode.
out=$(bash "$script" "${common[@]}" --mode tags --tag-pattern 'v*' --count 2 2>&1)
check $? "tags mode exits 0"
got=$(prs_by_release <<< "$out")
want=$'v3: 4\nv2: 1 2 3'
[ "$got" = "$want" ]
check $? "tags mode: v3 -> 4; v2 -> 1 2 3"
[ "$got" = "$want" ] || printf '  want: %q\n  got:  %q\n' "$want" "$got"

# 4. Settings come from .claude/changelog.json when flags are absent.
mkdir -p "$repo/.claude"
echo '{"repo":"o/r","release":{"mode":"tags","main_branch":"main","tag_pattern":"v*"}}' > "$repo/.claude/changelog.json"
got=$(bash "$script" --count 1 2>&1 | prs_by_release)
[ "$got" = "v3: 4" ]
check $? "config file drives mode, branch and pattern"

# 5. Bad input fails loudly.
bash "$script" "${common[@]}" --mode tags --tag-pattern 'nope-*' >/dev/null 2>&1
[ $? -ne 0 ]
check $? "too few matching tags exits non-zero"

exit "$fail"
