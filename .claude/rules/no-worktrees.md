# No Git Worktrees — Aniston HRMS

## Core Rule
**NEVER use `isolation: "worktree"` or `git worktree add` in this project.**

## Why
Git worktrees create separate hidden working directories under `.claude/worktrees/`.
Changes made in a worktree:
- Do NOT appear in VS Code Source Control for the main project
- Are NOT automatically committed or pushed to GitHub
- Result in scattered, invisible changes that the user cannot review
- Require manual cleanup with `git worktree remove`

The user needs ALL changes visible in the main working tree as a single unified diff.

## What to do instead
All agents MUST make changes directly in the main working tree:
`c:\Users\aniston user\Desktop\Aniston-hrms\`

Do NOT pass `isolation: "worktree"` to the Agent tool.
Do NOT run `git worktree add` in Bash.

## Enforcement
- `git worktree add *` is in the deny list in `.claude/settings.json`
- `.claude/worktrees/` is in `.gitignore` so even if a worktree is accidentally created, it will never be committed
- If you find yourself in a worktree path (`.claude/worktrees/agent-*`), stop immediately and redo the work in the main directory

## Checking
Run `git worktree list` — it should always show only ONE entry (the main worktree).
If it shows more, run `git worktree remove -f -f <path>` to clean up.
