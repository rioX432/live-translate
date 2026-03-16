---
name: review-pr
description: Review a GitHub pull request
argument-hint: "[PR number or URL]"
user-invocable: true
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - TaskCreate
  - TaskUpdate
  - TaskList
---

# /review-pr — PR Code Review

Review the specified pull request.

## Steps

1. **Get PR info**: `gh pr view <number> --json number,title,body,baseRefName,headRefName,files`
2. **Checkout branch**: `git fetch origin <headRefName> && git checkout <headRefName>`
3. **Read changed files** in full
4. **Launch reviewers in parallel** based on changed file paths:
   - `src/engines/` or `src/pipeline/` → `engine-reviewer` agent
   - `src/renderer/` or `src/main/` or `src/preload/` → `ui-reviewer` agent
5. **Build check**: `npm run build`
6. **Aggregate results**: Combine findings by severity (Critical / Important / Suggestion) with `file:line` references
