#!/usr/bin/env bash
#
# release.sh — guided, confirm-at-every-step release flow for cinecule-app.
# Self-contained copy of nostackai-playground-app-ci-cd/scripts/release.sh (no other checkout needed).
# Needs: gh (logged in), git.
#
# Usage: bash .vscode/release.sh <step> [tag]
#   new-branch   create a branch off dev and switch to it
#   pr-dev       commit + push current branch + open PR  <branch> -> dev
#   merge-dev    merge the open PR into dev          (deploys dev.cinecule.com)
#   pr-stage     open PR  dev -> stage
#   merge-stage  merge the open PR into stage        (deploys test.cinecule.com)
#   draft-tag    create a DRAFT release tag off stage
#   publish-tag  publish the tag -> DEPLOY TO PROD   (cinecule.com)
#
# Env overrides: MERGE_METHOD (default --squash), STAGE_MERGE_METHOD (default --merge), MERGE_FLAGS.

set -euo pipefail

ORG="versionedio"
MERGE_METHOD="${MERGE_METHOD:---squash}"            # feature → dev (step 2): collapse feature commits
STAGE_MERGE_METHOD="${STAGE_MERGE_METHOD:---merge}" # dev → stage (step 4): keep a real merge commit
MERGE_FLAGS="${MERGE_FLAGS:-}"   # extra gh-merge flags, e.g. --admin (bypass protection) or --auto (queue until checks pass)
REPO="cinecule-app"

die()  { echo "✗ $*" >&2; exit 1; }

command -v gh >/dev/null || die "GitHub CLI ('gh') is not installed."

step_name() {
  case "$1" in
    0) echo "new-branch" ;; 1) echo "pr-dev" ;; 2) echo "merge-dev" ;; 3) echo "pr-stage" ;;
    4) echo "merge-stage" ;; 5) echo "draft-tag" ;; 6) echo "publish-tag" ;;
    *) echo "$1" ;;
  esac
}

confirm() {  # each arg = one line shown in the box
  echo
  echo  "  ┌─────────────────────────────────────────────────────────────"
  for line in "$@"; do printf '  │  %s\n' "$line"; done
  echo  "  └─────────────────────────────────────────────────────────────"
  read -r -p "  Proceed? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Aborted — nothing changed."
}

# first open PR with the given base branch -> "<number>|<head>|<title>" (empty if none)
open_pr() {
  gh -R "$ORG/$REPO" pr list --base "$1" --state open \
     --json number,headRefName,title \
     --jq '.[0] | select(.number) | "\(.number)|\(.headRefName)|\(.title)"'
}

require_semver() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Tag '$1' is not semver (expected vX.Y.Z)."
}

# echo a merge-method flag the repo actually allows, preferring $1 (repos differ on merge/squash/rebase)
resolve_method() {  # $1 = preferred method flag
  local want="$1" caps merge squash rebase
  caps="$(gh repo view "$ORG/$REPO" \
            --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed \
            --jq '[.mergeCommitAllowed,.squashMergeAllowed,.rebaseMergeAllowed]|@tsv' 2>/dev/null)" \
    || { echo "$want"; return; }
  IFS=$'\t' read -r merge squash rebase <<< "$caps"
  case "$want" in
    --merge)  [[ "$merge"  == true ]] && { echo --merge;  return; } ;;
    --squash) [[ "$squash" == true ]] && { echo --squash; return; } ;;
    --rebase) [[ "$rebase" == true ]] && { echo --rebase; return; } ;;
  esac
  [[ "$squash" == true ]] && { echo --squash; return; }
  [[ "$merge"  == true ]] && { echo --merge;  return; }
  [[ "$rebase" == true ]] && { echo --rebase; return; }
  echo "$want"
}

# merge a PR with an allowed method; on a real conflict say so, on branch protection offer an admin override
merge_pr() {  # $1 = PR number, $2 = preferred method (default: $MERGE_METHOD)
  local want="${2:-$MERGE_METHOD}" method out; method="$(resolve_method "$want")"
  [[ "$method" == "$want" ]] || echo "  ℹ Using $method (repo doesn't allow $want)."
  out="$(gh -R "$ORG/$REPO" pr merge "$1" $method $MERGE_FLAGS 2>&1)" && { echo "$out"; return 0; }
  echo "$out"
  if grep -qiE "cannot be cleanly created|merge conflict|has conflicts" <<<"$out"; then
    die "PR #$1 has merge conflicts — admin can't bypass these. Resolve them first (e.g. 'gh pr view $1 --web')."
  fi
  echo
  echo "  ⚠ Merge blocked by branch protection (required reviews/checks)."
  read -r -p "  Retry with admin override (--admin)? [y/N] " a
  case "$a" in
    y|Y) gh -R "$ORG/$REPO" pr merge "$1" $method --admin ;;
    *)   die "Not merged. (Set MERGE_FLAGS=--auto to queue until checks pass, or merge in the GitHub UI.)" ;;
  esac
}

# ── args ──────────────────────────────────────────────────────────────────────
[[ $# -ge 1 ]] || die "Usage: $0 <new-branch|pr-dev|merge-dev|pr-stage|merge-stage|draft-tag|publish-tag> [tag]"

STEP="$(step_name "$1")"
TAG="${2:-}"

# run from the repo root (this script lives in <root>/.vscode)
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Repo:  $ORG/$REPO"
echo "Step:  $STEP"

case "$STEP" in
  new-branch)
    [[ -d .git ]] || die "Not in a checkout of $REPO (run from the repo)."
    git fetch origin dev
    read -r -p "  New branch name (off dev): " BR
    [[ -n "$BR" ]] || die "No branch name given."
    git show-ref --verify --quiet "refs/heads/$BR" && die "Branch '$BR' already exists."
    confirm "REPO   : $ORG/$REPO" "ACTION : create branch '$BR' off origin/dev and switch to it"
    git checkout -b "$BR" origin/dev
    ;;

  pr-dev)
    [[ -d .git ]] || die "Not in a checkout of $REPO (run from the repo)."
    BR="$(git rev-parse --abbrev-ref HEAD)"
    case "$BR" in dev|stage|main) die "You're on '$BR' — switch to your feature branch first." ;; esac
    dirty="$(git status --porcelain)"
    nfiles=$([[ -n "$dirty" ]] && printf '%s\n' "$dirty" | wc -l | tr -d ' ' || echo 0)
    confirm "REPO    : $ORG/$REPO" "BRANCH  : $BR" "ACTION  : commit ($nfiles file(s)) + push + open PR   $BR → dev"
    if [[ -n "$dirty" ]]; then
      git add -A
      read -r -p "  Commit message [$BR]: " msg
      git commit -m "${msg:-$BR}"
    fi
    git push -u origin "$BR"
    [[ "$(git rev-list --count origin/dev..HEAD)" -gt 0 ]] || die "No commits ahead of dev — nothing to PR."
    pr="$(gh -R "$ORG/$REPO" pr list --base dev --head "$BR" --state open --json number --jq '.[0].number // empty')"
    if [[ -n "$pr" ]]; then
      echo "  PR already open: #$pr (pushed new commits to it)"
    else
      gh -R "$ORG/$REPO" pr create --base dev --head "$BR" --fill \
        || gh -R "$ORG/$REPO" pr create --base dev --head "$BR" --title "$BR → dev" --body "Promote $BR to dev."
    fi
    ;;

  merge-dev)
    info="$(open_pr dev)"; [[ -n "$info" ]] || die "No open PR into dev."
    IFS='|' read -r num head title <<< "$info"
    confirm "REPO   : $ORG/$REPO" "ACTION : MERGE PR #$num   ($head → dev)" "TITLE  : $title" "METHOD : $MERGE_METHOD $MERGE_FLAGS"
    merge_pr "$num"
    ;;

  pr-stage)
    confirm "REPO   : $ORG/$REPO" "ACTION : open PR   dev → stage"
    # Explicit --body (not --fill): --fill derives the body from the *local* dev branch, which is
    # often stale vs origin/dev and then fails with "no commits between origin/stage and dev" even
    # though the remote branches differ. The PR is created server-side from origin/dev regardless.
    gh -R "$ORG/$REPO" pr create --base stage --head dev --title "dev → stage" --body "Promote dev → stage."
    ;;

  merge-stage)
    info="$(open_pr stage)"; [[ -n "$info" ]] || die "No open PR into stage."
    IFS='|' read -r num head title <<< "$info"
    [[ "$head" == "dev" ]] || die "Open PR into stage is from '$head' (expected 'dev') — aborting."
    confirm "REPO   : $ORG/$REPO" "ACTION : MERGE PR #$num   (dev → stage)" "TITLE  : $title" "METHOD : $STAGE_MERGE_METHOD $MERGE_FLAGS"
    merge_pr "$num" "$STAGE_MERGE_METHOD"
    ;;

  draft-tag)
    [[ -n "$TAG" ]] || read -r -p "  Tag (semver, e.g. v1.2.3): " TAG
    require_semver "$TAG"
    confirm "REPO   : $ORG/$REPO" "ACTION : create DRAFT tag $TAG off 'stage'" "VIA    : prepare-release-tag.yml"
    gh -R "$ORG/$REPO" workflow run prepare-release-tag.yml -f tag="$TAG" -f target=stage
    echo "  → watch:  gh -R $ORG/$REPO run list --workflow=prepare-release-tag.yml -L1"
    ;;

  publish-tag)
    [[ -n "$TAG" ]] || read -r -p "  Draft tag to publish (e.g. v1.2.3): " TAG
    require_semver "$TAG"
    confirm "REPO   : $ORG/$REPO" "ACTION : PUBLISH tag $TAG  →  DEPLOY TO PROD" "VIA    : publish-release-tag.yml"
    gh -R "$ORG/$REPO" workflow run publish-release-tag.yml -f tag="$TAG" -f expectedTarget=stage
    echo "  → watch:  gh -R $ORG/$REPO run list --workflow=publish-release-tag.yml -L1"
    ;;

  *) die "Unknown step '$STEP' (use: new-branch | pr-dev | merge-dev | pr-stage | merge-stage | draft-tag | publish-tag)." ;;
esac

echo "✓ Done: $STEP on $ORG/$REPO"
