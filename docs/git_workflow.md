# Git Workflow

GitHub Flow with auto-commit. One main branch, short-lived feature branches, PRs into `main`.

## Quick reference

```bash
# Start a feature
git checkout -b feat/short-name

# Work — the Stop hook auto-commits and auto-pushes after every Claude response.
# First push of a new branch sets upstream automatically (git push -u origin HEAD).

# Open a PR when ready
gh pr create --base main --title "..." --body "..."

# Merge (squash keeps main linear) and clean up
gh pr merge --squash --delete-branch
git checkout main && git pull
```

## Branches

| Prefix     | Use for                                     |
| ---------- | ------------------------------------------- |
| `feat/`    | New features                                |
| `fix/`     | Bug fixes                                   |
| `refactor/`| Code restructuring with no behavior change  |
| `docs/`    | Documentation-only changes                  |
| `chore/`   | Tooling, config, dependencies               |

Branches are short-lived — open the PR as soon as the work is reviewable, even if rough. Long-running branches drift.

## The auto-commit hook

Defined in `.claude/settings.local.json` as a `Stop` hook. After every Claude response it runs:

```bash
git add -A
git diff --cached --quiet || git commit -m "auto: <files>"
git push -u origin HEAD 2>/dev/null || true
```

Consequences:

- **You don't commit manually.** Don't run `git commit` yourself unless explicitly working around the hook.
- **The hook commits on whatever branch is checked out.** So `git checkout -b feat/foo` *before* the first edit on a new feature.
- **First push of a new branch is automatic.** `-u origin HEAD` creates the remote branch and sets tracking.
- **Push failures are silent** (`2>/dev/null || true`). If a push gets rejected (e.g., non-fast-forward), the commit still lands locally but the remote is out of sync — check with `git status` if something seems off.

## PR rules

- **Squash-merge into `main`.** The branch will have a stream of `auto: ...` commits; squashing turns them into one clean commit with the PR title as the message.
- **Write the PR title like a commit message** — it becomes the merge commit on `main`.
- **One feature per PR.** If a branch grows two unrelated changes, split it.
- **Delete the branch after merge** (`--delete-branch` or the GitHub UI button).

## Starting new work

If you realize you've started editing on `main` and the change deserves its own branch, do it *before* the next auto-commit fires:

```bash
git checkout -b feat/foo    # moves uncommitted changes onto the new branch
```

If the auto-commit already pushed to `main`, you can still move the commits to a branch:

```bash
git checkout -b feat/foo
git checkout main
git reset --hard origin/main~N    # N = number of commits to undo (destructive — check git log first)
git push --force-with-lease origin main   # only safe on a solo repo
```

Avoid `--force` pushes on shared branches.

## Syncing main

```bash
git checkout main
git pull --ff-only
```

If `--ff-only` fails, the local `main` has diverged — usually means you committed directly to `main` while a PR also merged. Reset to the remote:

```bash
git fetch origin
git reset --hard origin/main
```
