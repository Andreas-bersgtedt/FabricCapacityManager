# Branch A - Admin Mode Implementation Checklist (GitHub Issue Pack)

> **Status: Delivered.** Admin Mode is implemented in
> [src/admin/](../src/admin/): scale, pause/resume, and same-geography move,
> with shared confirm/preflight/operation-status components. Live
> management-plane writes are opt-in via `VITE_ADMIN_LIVE_WRITES`; otherwise
> operations validate against a local simulation. A cross-region move was built
> and then removed (it did not reassign workspaces reliably), so issue 5 below
> is struck through. This document is retained as the original delivery plan.

Use this document to create and track the delivery work for Branch A.

## Epic Issue

### Title
`[Epic] Branch A - Admin Mode Capacity Operations`

### Summary
Deliver Admin Mode operations with safety rails and auditability:
1. Scale capacity up/down
2. Pause/resume capacity
3. Move workspace to another capacity (same geography)
4. ~~Move workspace cross-region only when all impacted items support cross-region movement~~ _(removed)_

### Scope
- In scope: UI actions, API integration, preflight validation, operation tracking, and auditable logs.
- Out of scope: scheduling windows, custom policy engine, cross-tenant orchestration.

### Definition of Done
- All child issues completed.
- End-to-end manual test plan passes in a non-production tenant.
- Audit records emitted for every write operation path (success/failure/cancel).

---

## Sequenced Child Issues

## 1. Foundation: Admin mode shell and permissions

### Title
`[Branch A][A1] Admin Mode shell, permissions, and guardrails`

### Checklist
- [ ] Add Admin Mode feature flag and runtime toggle.
- [ ] Add role/permission gate so write actions are hidden/disabled for non-admin users.
- [ ] Add operation confirmation modal scaffold (shared component).
- [ ] Add operation preview panel scaffold (inputs, validation state, impact text).
- [ ] Add audit event model and client-side telemetry hook.
- [ ] Add shared error envelope type and user-facing error renderer.

### Acceptance Criteria
- Admin controls are visible only to authorized users.
- Shared confirm + preview patterns are reusable by all Branch A operations.
- Audit event is generated for each attempted admin action.

### Dependencies
- Existing auth context and capacity/workspace data loading.

---

## 2. Capacity scale operations

### Title
`[Branch A][A2] Capacity scale up/down operation`

### Checklist
- [ ] Add target SKU picker for selected capacity.
- [ ] Add preflight API call for scale validation.
- [ ] Add submit action for scale request.
- [ ] Add async operation polling/status refresh.
- [ ] Add optimistic UI lock while operation is in progress.
- [ ] Add error mapping for common failures (permission, invalid transition, conflict).
- [ ] Add audit logs for preflight, submit, completion.

### Acceptance Criteria
- User can scale capacity to a valid SKU.
- Invalid transitions are blocked before submit.
- Final state and timestamps are visible in UI.

### Dependencies
- Issue 1 complete.

---

## 3. Capacity pause/resume operations

### Title
`[Branch A][A2] Capacity pause/resume operation`

### Checklist
- [ ] Add pause action with impact warning text.
- [ ] Add resume action with readiness check.
- [ ] Add preflight checks for current capacity state and eligibility.
- [ ] Add submit actions and operation status polling.
- [ ] Add post-action verification that capacity reached target state.
- [ ] Add audit logs for pause/resume request and final outcome.

### Acceptance Criteria
- Pause works only for eligible running capacities.
- Resume works only for paused capacities.
- UI reflects transitional and final states.

### Dependencies
- Issue 1 complete.

---

## 4. Workspace move (same geography)

### Title
`[Branch A][A3] Workspace move within same geography`

### Checklist
- [ ] Add destination capacity selector filtered to same geography.
- [ ] Add preflight checks: destination capacity health, SKU constraints, user rights.
- [ ] Add submit move action.
- [ ] Add move operation status and completion refresh.
- [ ] Add workspace regroup/refresh after successful move.
- [ ] Add audit logs for source, destination, workspace, outcome.

### Acceptance Criteria
- User can move a workspace to an eligible destination in the same geography.
- Ineligible destinations are blocked with clear reason.
- Workspace tree updates to new capacity group on success.

### Dependencies
- Issue 1 complete.

---

## 5. Workspace move (cross-region eligibility and workflow) _(removed)_

> Built and then removed because the operation did not reassign workspaces
> reliably. Retained here for history.

### Title
`[Branch A][A4] Cross-region move eligibility and guided workflow`

### Checklist
- [ ] Add item-level support matrix model for cross-region movement.
- [ ] Add eligibility engine that evaluates all items in a workspace.
- [ ] Add unsupported-item report in preflight view.
- [ ] Block submit when any item is unsupported.
- [ ] Add guided cross-region confirmation with impact messaging.
- [ ] Add submit flow for eligible cross-region moves.
- [ ] Add audit logs including eligibility decision and item summary.

### Acceptance Criteria
- Cross-region move cannot be submitted when unsupported items are present.
- Eligible workspaces can complete cross-region move flow.
- Blocking reasons are explicit and actionable.

### Dependencies
- Issue 4 complete.

---

## 6. Test, hardening, and documentation

### Title
`[Branch A][Hardening] Test coverage, runbook, and rollout notes`

### Checklist
- [ ] Add unit tests for validators and eligibility engine.
- [ ] Add integration tests for each operation happy path + key failure paths.
- [ ] Add manual test runbook for admin actions in a test tenant.
- [ ] Add rollout safeguards (feature flag defaults, environment checks).
- [ ] Update user/admin docs with known limitations.

### Acceptance Criteria
- Test suite passes and covers all Branch A validations.
- Manual runbook verified by at least one non-author reviewer.
- Feature can be safely toggled off without code rollback.

### Dependencies
- Issues 2-5 complete.

---

## Suggested Labels and Milestones

- Labels:
  - `feature`
  - `admin-mode`
  - `branch-a`
  - `fabric-api`
  - `needs-validation`
- Milestone:
  - `Branch A - Admin Mode`

## Suggested Delivery Order

1. Issue 1 (Foundation)
2. Issues 2 and 3 (can run in parallel after Issue 1)
3. Issue 4
4. Issue 5
5. Issue 6
