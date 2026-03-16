---
name: dev
description: "End-to-end: investigate → implement → test → review → PR"
argument-hint: "[GitHub issue #, e.g. #1]"
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

# /dev — End-to-End Development Workflow

Execute the full development cycle for an issue: investigate → implement → test → review → PR.

## Step 1: Understand the Issue
1. Fetch issue details: `gh issue view <number>`
2. Read related code files mentioned in the issue
3. Identify root cause or implementation approach

## Step 2: Plan
1. Break down into tasks using TaskCreate
2. Identify affected files and dependencies
3. If unclear, ask user via AskUserQuestion

## Step 3: Implement
1. Create a feature branch: `git checkout -b fix/<issue-number>-<short-desc>`
2. Implement changes following existing patterns
3. Run `npm run build` to verify no type errors

## Step 4: Self-Review
1. Read all changed files in full
2. Verify consistency with engine interfaces and pipeline patterns
3. Check for edge cases (empty audio, API errors, offline mode)

## Step 5: Cross-Review
1. Launch engine-reviewer agent for engine changes
2. Launch ui-reviewer agent for UI changes
3. Address any Critical findings

## Step 6: Create PR
1. Commit with descriptive message
2. Push branch
3. Create PR: `gh pr create --title "Fix #<number>: <description>" --body "..."`
