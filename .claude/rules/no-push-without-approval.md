---
name: no-push-without-approval
type: rule
applies_to: ["git", "github", "release", "deploy"]
---

# No Push Without Approval — Aniston HRMS

## Core Rule
NEVER push code to any remote branch, create a pull request, or trigger a deployment without explicit user approval.

## Specific Prohibitions

### Never Do These Without Explicit Instruction
- `git push` to any remote branch
- `git push --force` or `git push --force-with-lease` (NEVER to main/master)
- `git push origin main` — this triggers CI/CD and production deployment
- Opening a GitHub Pull Request
- Merging a Pull Request
- Creating a GitHub Release
- Triggering a GitHub Actions workflow manually
- Deploying to EC2 via SSH/SCP

### Never Do These At All (Even With Instruction)
- `git push --force origin main` — force-pushing to main/master is always destructive
- Amending commits that have already been pushed to remote
- Rebasing published commits (creates diverged history)
- Deleting remote branches that others may be using

## When User Says "Push" or "Deploy"
Before executing:
1. Show the user exactly what will be pushed (git diff summary, commit list)
2. Confirm the target branch
3. Warn if pushing to `main` (triggers production CI/CD)
4. Warn if there are failing tests or lint errors
5. Get explicit confirmation: "Yes, push this to [branch]"

## Pull Request Requirements
Before creating a PR:
1. Show summary of all commits in the branch
2. Show diff statistics
3. Confirm base branch (usually `main`)
4. Get explicit approval from user

## Commit Rules
- Only commit when user explicitly requests it
- Never use `git add .` or `git add -A` — add specific files only
- Always show `git status` and `git diff --staged` before committing
- Never skip hooks (`--no-verify`) unless user explicitly requests
- Never amend published commits (use new commit instead)

## Safe Git Operations (Pre-Approved)
These read-only operations are safe without approval:
- `git status`
- `git diff`
- `git log`
- `git branch`
- `git show`

## Emergency Rollback Exception
If a production-breaking bug is confirmed and user says "emergency rollback":
- Still show the rollback plan before executing
- Still require confirmation
- Document what is being rolled back and why