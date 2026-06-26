# Product Roadmap

This document tracks planned features and delivery sequencing for Fabric Capacity Manager.

## Delivered

- **Workspace inventory** grouped by Region › Capacity SKU › Capacity Name, with
  storage-mode, item-type and name filters, and Excel export.
- **Dashboard tab** — tenant-wide aggregated KPIs (workspaces, capacities,
  items, regions, SKUs, estimated monthly compute cost, OneLake storage) and
  distribution breakdowns by region, SKU, storage mode and item type.
- **Cost estimates** — per-capacity estimated monthly pay-as-you-go compute
  cost from the Azure Retail Prices API, in a configurable currency.
- **OneLake storage (opt-in)** — current/billable storage per workspace from the
  Microsoft Fabric Capacity Metrics model via the Power BI `executeQueries`
  (DAX) API, with auto-discovery, custom query support and raw-result display.
- **Branch A — Admin Mode capacity operations** (see below): scale, pause/resume,
  same-geography workspace move, and gated cross-region move. Validation runs
  against a local simulation by default. The functional live-write capability
  (real management-plane operations, opt-in via `VITE_ADMIN_LIVE_WRITES`) is in
  **Preview**.

## Preview

- **Admin Mode live writes** — executing real capacity operations against Azure
  Resource Manager and the Fabric REST API. Disabled by default; enable with
  `VITE_ADMIN_LIVE_WRITES=true` and the additional opt-in permissions described
  in the README. Treat as a preview capability and validate in a non-production
  tenant first.

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
3. **Move a workspace to a different capacity**
   - **A. Same geography move**
   - **B. Cross-region move** (only when all impacted items support cross-region movement)

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

4. **A4: Cross-region move orchestration**
   - Eligibility checks per workspace item type.
   - Block move when any item is not cross-region supported.
   - Guided workflow for supported moves, including impact and expected downtime messaging.

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

- **Move workspace (cross-region)**
  - System validates that all workspace items support cross-region movement.
  - Unsupported item types block operation and are listed clearly.
  - When supported, user can proceed with a guided move flow.

#### Non-Goals (Branch A)

- Full policy engine for custom governance rules.
- Automated scheduling windows for operations.
- Multi-tenant orchestration across unrelated Fabric tenants.

#### Dependencies

- Fabric APIs for capacity management and workspace assignment operations.
- Tenant settings and permissions required for admin-level write operations.
- A maintained support matrix for item-type cross-region mobility.

#### Exit Criteria

- Admin can complete each Branch A operation from UI with validation and confirmations.
- Every operation generates an auditable record.
- Cross-region moves are blocked by default unless all items pass support checks.
