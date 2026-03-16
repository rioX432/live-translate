---
name: audit
description: "Audit codebase for issues and create GitHub Issues"
argument-hint: "[scope: engines|ui|pipeline|all (default: all)]"
user-invocable: true
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Agent
  - TaskCreate
  - TaskUpdate
  - TaskList
  - AskUserQuestion
  - WebSearch
---

# /audit — Codebase Health Audit

Audit live-translate for bugs, tech debt, and missing features. Findings become GitHub Issues.

**Scope:** "$ARGUMENTS" (engines | ui | pipeline | all — default: all)

## Step 1: Static Check
- Run `npm run build` and check for type errors

## Step 2: Code Scans (Parallel Agents)

Launch subagents based on scope:

### Engine Audit
- Verify all engines implement interfaces correctly
- Check error handling in processAudio/translate/initialize/dispose
- Verify model download robustness (retry, partial download cleanup)
- Check for hardcoded values that should be configurable

### UI Audit
- Verify subtitle overlay works on external displays
- Check settings panel state management
- Verify IPC data flow (renderer → main → subtitle window)
- Check accessibility and readability of subtitle fonts

### Pipeline Audit
- Verify cascade and e2e modes work correctly
- Check hot-swap engine switching
- Verify event emission and error propagation
- Check transcript logging completeness

## Step 3: Aggregate & Create Issues
- Present findings to user grouped by severity
- Create GitHub Issues for approved findings: `gh issue create`
