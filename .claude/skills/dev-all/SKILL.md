---
name: dev-all
description: "Process multiple GitHub Issues on a single branch. Investigates in parallel, implements sequentially, creates one PR."
argument-hint: "[issue numbers, e.g. #1 #2 #3, or empty for all open issues]"
user-invocable: true
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Agent
  - TaskCreate
  - TaskUpdate
  - TaskList
  - AskUserQuestion
  - WebSearch
  - WebFetch
---

# /dev-all — Batch Development on Single Branch

Process multiple GitHub Issues on **one branch** with **one PR**. Avoids merge conflicts from parallel branches.

## Step 1: Gather Issues

If arguments provided, use those issue numbers. Otherwise:
```bash
gh issue list --state open --json number,title,labels --limit 20
```

Present the list to the user and ask which issues to include (or confirm all).

## Step 2: Create Branch

```bash
git checkout main && git pull
git checkout -b dev/batch-$(date +%Y%m%d)
```

## Step 3: Parallel Investigation

Launch **one Agent per issue** in parallel to investigate:
- Read the issue description
- Identify affected files and root cause
- Propose implementation approach
- Estimate complexity (small / medium / large)

Present investigation results to the user. Ask for approval or adjustments.

## Step 4: Create Task List

Create tasks for all issues using TaskCreate. Order by:
1. Dependencies (foundational changes first)
2. Complexity (small → large)
3. Related files grouped together to minimize conflicts

## Step 5: Sequential Implementation

For each issue, in order:
1. Mark task as `in_progress`
2. Implement the fix/feature
3. Run `npm run build` to verify no type errors
4. Commit with message: `Fix #<number>: <short description>`
5. Mark task as `completed`

## Step 6: Self-Review

1. Review all changes: `git diff main...HEAD`
2. Launch reviewers in parallel based on changed files:
   - `src/engines/` or `src/pipeline/` → `engine-reviewer` agent
   - `src/renderer/` or `src/main/` → `ui-reviewer` agent
3. Fix any Critical findings

## Step 7: Push & Create PR

```bash
git push -u origin HEAD
```

Create PR with all issues referenced:
```bash
gh pr create --title "Fix #1, #2, #3: <summary>" --body "$(cat <<'EOF'
## Summary
- Fix #1: <description>
- Fix #2: <description>
- Fix #3: <description>

## Changes
<bullet list of key changes>

## Test Plan
- [ ] `npm run build` passes
- [ ] Manual test: <steps>
EOF
)"
```

## Step 8: Report

Show final summary:
- Issues addressed
- Files changed
- PR URL
- Any remaining items or follow-ups
