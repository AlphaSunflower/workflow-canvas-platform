# Project Checklist

Last updated: 2026-04-21

## Current Usage

This checklist is retained as a lightweight operator checklist. The previous version had encoding issues and mixed legacy assumptions. During the quality baseline recovery phase, this file should be treated as a high-level gate summary, not as the full product acceptance checklist.

For issue tracking and freeze rules, use:

- `quality-baseline-plan.md`
- `quality-baseline-issues.md`

## Quality Baseline Gate

Before feature work resumes, all items below must be true:

- [ ] Frontend `npm.cmd run typecheck` passes
- [ ] Frontend `npm.cmd run lint` passes
- [ ] Frontend `npm.cmd test` passes
- [ ] Backend root `npm.cmd run typecheck` passes
- [ ] P0 issues in `quality-baseline-issues.md` are closed
- [ ] Frozen paths were only changed for tracked baseline issues
- [ ] No new `any` or broad `eslint-disable` comments were added in frozen paths
- [ ] No new unbounded retry loops were introduced
- [ ] Persistence boundary changes include save/hydrate/reload coverage
- [ ] `WorkflowContext.tsx` changes include focused regression coverage
- [ ] `Canvas.tsx` changes include focused regression coverage

## Current Baseline Snapshot

- [x] Frontend typecheck currently passes
- [ ] Frontend lint currently passes
- [ ] Frontend tests currently pass
- [x] Backend typecheck currently passes
- [ ] Backend tests currently have a root automated gate

## Frozen High-Risk Paths

- [ ] `frontend/src/components/context/**`
- [ ] `frontend/src/components/canvas/**`
- [ ] `frontend/src/execution-runtime/**`
- [ ] `frontend/src/services/workflow-file-normalizer.ts`
- [ ] `frontend/src/services/backendExecutionService.ts`
- [ ] `frontend/src/services/workflow-upload-scheduler.ts`
- [ ] `frontend/src/services/image/**`
- [ ] `frontend/src/nodes/ai-storyboard/**`
- [ ] `frontend/src/nodes/shared/**`
- [ ] `backend/shared/src/**`
- [ ] `backend/api/src/modules/workflows/**`
- [ ] `backend/api/src/modules/files/**`
- [ ] `backend/worker/src/modules/executors/**`
- [ ] `backend/worker/src/modules/queue/**`

## Required Behavior During Recovery

- [ ] Every baseline fix references an issue ID from `quality-baseline-issues.md`
- [ ] Failing tests are fixed through behavior correction, not assertion weakening
- [ ] New blockers are added to the issue ledger before or with the fix
- [ ] Documentation is updated when a boundary contract changes

## Exit Decision

Quality baseline recovery can be marked complete only when:

- [ ] The quality gate is green
- [ ] The issue ledger has no untriaged entries
- [ ] The remaining deferred issues have owners and rationale
- [ ] The team agrees the freeze can be lifted
