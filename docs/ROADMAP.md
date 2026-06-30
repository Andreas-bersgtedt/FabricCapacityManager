# Product Roadmap

This document tracks planned features and delivery sequencing for Fabric Capacity Manager.

## Delivered

- **Workspace inventory** grouped by Region › Capacity SKU › Capacity Name, with
  storage-mode, item-type and name filters, and Excel export.
- **Dashboard tab**: tenant-wide aggregated KPIs (workspaces, capacities,
  items, regions, SKUs, estimated monthly compute cost, OneLake storage) and
  distribution breakdowns by region, SKU, storage mode and item type.
- **Cost estimates**: per-capacity estimated monthly pay-as-you-go compute
  cost from the Azure Retail Prices API, in a configurable currency.
- **Actual billed cost (opt-in)**: real pre-tax compute cost per capacity over
  the trailing 28 days from the Azure Cost Management query API, shown as a
  per-capacity pill and an aggregated Dashboard KPI. Gated behind live writes;
  best-effort on missing Cost Management access.
- **Capacity uptime (opt-in)**: percentage of the trailing 28 days each capacity
  was running, reconstructed from Azure Activity Log suspend/resume events.
  Gated behind live writes; best-effort on missing ARM access.
- **OneLake storage (opt-in)**: current/billable storage per workspace from the
  Microsoft Fabric Capacity Metrics model via the Power BI `executeQueries`
  (DAX) API, with auto-discovery, custom query support and raw-result display.
- **Branch A: Admin Mode capacity operations** (see below): scale, pause/resume,
  and same-geography workspace move. Validation runs against a local simulation
  by default. The live-write capability (real management-plane operations, opt-in
  via `VITE_ADMIN_LIVE_WRITES`) is in **Preview**.

## Preview

- **Admin Mode live writes**: executing real capacity operations against Azure
  Resource Manager and the Fabric REST API. Disabled by default; enable with
  `VITE_ADMIN_LIVE_WRITES=true` and the additional opt-in permissions described
  in the README. Treat as a preview capability and validate in a non-production
  tenant first.

  **Path to GA:**
  - [x] Durable audit persistence: every operation (blocked / attempted /
    succeeded / failed / cancelled) is written to a local store that survives a
    reload, with an in-app **Audit history** panel (`src/admin/core/auditStore.ts`,
    `AuditContext.tsx`, `components/AuditHistoryPanel.tsx`).
  - [x] Remote audit sink: events are forwarded to a central collector behind
    the same `persistAuditEvent` surface (`src/admin/core/remoteAuditSink.ts`),
    with at-least-once delivery via a retry outbox. Opt-in via
    `VITE_AUDIT_REMOTE_URL` (and optional `VITE_AUDIT_REMOTE_SCOPE` for an
    authenticated collector). A reference collector backend (Azure Functions to
    Application Insights + Table Storage, with Entra JWT validation) ships in
    [`collector/`](../collector/README.md).
  - [x] One-command provisioning: the collector ships keyless Bicep IaC
    ([`collector/infra/main.bicep`](../collector/infra/main.bicep)) that stands
    up a Flex Consumption Function App with a system-assigned managed identity,
    a storage account with shared-key access disabled, Application Insights, and
    least-privilege RBAC. No keys or connection strings are provisioned.
  - [ ] End-to-end live-write validation in a non-production tenant across the
    three operations, with documented results.
  - [ ] Graduate to GA: enable live writes by default for permitted admins and
    retire the `VITE_ADMIN_LIVE_WRITES` gate.

## Planned

### Branch A - Admin Mode Capacity Operations

**Status:** Delivered. Live-write capability is in **Preview** (opt-in via
`VITE_ADMIN_LIVE_WRITES`; simulation by default).

**Goal:** Add an Admin Mode that enables safe, auditable capacity operations from the app.

**Delivery artifacts:**

- Execution checklist (GitHub issue format): [BRANCH_A_IMPLEMENTATION_CHECKLIST.md](BRANCH_A_IMPLEMENTATION_CHECKLIST.md)
- API contract and UI flows: [ADMIN_MODE_API_UI_SPEC.md](ADMIN_MODE_API_UI_SPEC.md)

#### Scope

1. **Scale capacity up or down**
2. **Pause or resume capacity**
3. **Move a workspace to another capacity in the same geography**

> **Removed:** a cross-region move operation was built and then removed because
> it did not reassign workspaces reliably. The `workspace.move.crossRegion`
> audit operation type is kept so previously recorded audit events still render,
> but no cross-region UI or client code ships. The original cross-region plan is
> struck through below for history.

#### Milestones

1. **A1: Admin foundation and safety rails**
   - Admin Mode toggle and role-aware UI visibility.
   - Explicit confirmation flow for any write action.
   - Operation preview (what changes, impact summary, and prerequisites).
   - Audit trail for who initiated operation, what changed, and outcome.

2. **A2: Capacity lifecycle operations**
   - Scale capacity up/down with SKU compatibility validation.
   - Pause and resume actions with pre-checks and post-action status verification.
   - Failure handling with clear error reasons and retry guidance.

3. **A3: Workspace reassignment operations**
   - Move workspace between capacities in the same geography.
   - Pre-move validation: destination capacity availability, permissions, and policy checks.
   - Bulk move readiness model (single move first, bulk as follow-up enhancement).

4. **A4: Cross-region move orchestration** _(removed)_
   - ~~Eligibility checks per workspace item type.~~
   - ~~Block move when any item is not cross-region supported.~~
   - ~~Guided workflow for supported moves, including impact and expected downtime messaging.~~

#### Functional Requirements

- **Scale up/down**
  - User can select a target SKU and submit a scale request.
  - System validates allowed transitions before submit.
  - UI shows in-progress, success, or failed status with timestamp.

- **Pause/resume**
  - User can pause an eligible running capacity.
  - User can resume a paused capacity.
  - UI warns about user impact before pause and confirms readiness after resume.

- **Move workspace (same geography)**
  - User can select destination capacity in same geography.
  - System validates workspace and destination compatibility.
  - Move completion state is visible and refreshes workspace grouping.

- **Move workspace (cross-region)** _(removed)_
  - ~~System validates that all workspace items support cross-region movement.~~
  - ~~Unsupported item types block operation and are listed clearly.~~
  - ~~When supported, user can proceed with a guided move flow.~~

#### Non-Goals (Branch A)

- Full policy engine for custom governance rules.
- Automated scheduling windows for operations.
- Multi-tenant orchestration across unrelated Fabric tenants.

#### Dependencies

- Fabric APIs for capacity management and workspace assignment operations.
- Tenant settings and permissions required for admin-level write operations.

#### Exit Criteria

- Admin can complete each Branch A operation from UI with validation and confirmations.
- Every operation generates an auditable record.

### Branch B - Operational maturity

**Status:** Proposed. Builds on the delivered Branch A foundation; sequenced
after Admin Mode live writes reach GA.

**Goal:** Take Admin Mode from single, manual operations to repeatable,
auditable, and cost-aware operations at scale.

#### Candidate scope

1. **Remote, tamper-evident audit trail**
   - Persist audit events to a durable backend (Application Insights / table
     storage) in addition to the local store.
   - Queryable history beyond the current device, with export.

2. **Bulk operations**
   - Multi-select capacities/workspaces for scale, pause/resume, and same-geo
     move (the delivered single-move model already anticipates this).
   - Per-item preflight, partial-failure handling, and an aggregate result view.

3. **Scheduling windows**
   - Auto-pause/resume on a schedule (e.g. off-hours) for cost control.
   - Previously a Branch A non-goal; revisited here as a first-class feature.

4. **Cost-aware recommendations**
   - Surface "idle capacity" and "oversized SKU" hints by combining the existing
     cost estimates and Capacity Metrics utilization data.

#### Non-Goals (Branch B)

- Full policy/governance engine with custom rule authoring.
- Cross-tenant orchestration across unrelated Fabric tenants.

#### Dependencies

- Admin Mode live writes at GA.
- A durable audit backend.
- Utilization signals from the Capacity Metrics model for recommendations.
