# Admin Mode API Contract and UI Action Flows (Branch A)

> **Implemented.** This contract is realized in [src/admin/](../src/admin/):
> the shared preflight → confirm → submit → poll model lives in
> `core/` (e.g. `useAdminOperation.ts`, `PreflightPanel`, `ConfirmDialog`,
> `OperationStatusView`), with one slice per operation under `slices/`.
>
> **Cross-region move removed.** The `workspace.move.crossRegion` operation was
> removed from the app because it did not reassign workspaces reliably. Its type
> stays in `AdminOperationType` only so historical audit events still render.
> The cross-region content below (validation rule 4, the support matrix, and
> flow D) describes the original design and no longer matches shipping code.

This document defines a practical API contract and UI behavior model for Branch A operations.

## Goals

- Provide a single, consistent execution model for all admin write operations.
- Enforce preflight validation before any mutating call.
- Preserve safety via confirmations and clear impact messaging.
- Ensure auditable operation events.

## Operating Model

Each action follows a common sequence:
1. User selects an operation and target.
2. Client calls a preflight endpoint.
3. Client renders validation results and impact summary.
4. User confirms action.
5. Client submits operation.
6. Client polls operation status until terminal state.
7. Client refreshes impacted capacity/workspace data and writes audit event.

## Core API Contract (App-layer)

These are app-internal contract shapes. Back-end/Fabric API routes can be mapped underneath.

## Common Types

```ts
export type AdminOperationType =
  | "capacity.scale"
  | "capacity.pause"
  | "capacity.resume"
  | "workspace.move.sameGeo"
  | "workspace.move.crossRegion";

export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationMessage {
  code: string;
  severity: ValidationSeverity;
  message: string;
  target?: string;
}

export interface AdminPreflightResponse {
  operationType: AdminOperationType;
  isAllowed: boolean;
  messages: ValidationMessage[];
  impactSummary: string[];
  requiresConfirmation: boolean;
  confirmationText?: string;
  correlationId: string;
}

export interface AdminSubmitResponse {
  operationId: string;
  operationType: AdminOperationType;
  status: "queued" | "inProgress";
  correlationId: string;
}

export interface AdminOperationStatus {
  operationId: string;
  operationType: AdminOperationType;
  status: "queued" | "inProgress" | "succeeded" | "failed" | "cancelled";
  startedAtUtc?: string;
  completedAtUtc?: string;
  messages: ValidationMessage[];
  correlationId: string;
}

export interface AuditEvent {
  operationId?: string;
  operationType: AdminOperationType;
  actorObjectId?: string;
  targetIds: Record<string, string>;
  outcome: "attempted" | "blocked" | "succeeded" | "failed" | "cancelled";
  timestampUtc: string;
  correlationId: string;
  details?: Record<string, string>;
}
```

## Endpoints (Logical)

```http
POST /admin/operations/preflight
POST /admin/operations/submit
GET  /admin/operations/{operationId}
POST /admin/audit-events
```

## Request Shapes (Logical)

```ts
export interface ScaleCapacityRequest {
  operationType: "capacity.scale";
  capacityId: string;
  fromSku: string;
  toSku: string;
}

export interface PauseResumeCapacityRequest {
  operationType: "capacity.pause" | "capacity.resume";
  capacityId: string;
}

export interface MoveWorkspaceRequest {
  operationType: "workspace.move.sameGeo" | "workspace.move.crossRegion";
  workspaceId: string;
  sourceCapacityId: string;
  destinationCapacityId: string;
}
```

## Operation-Specific Validation Rules

## 1. Capacity Scale
- `toSku` must differ from `fromSku`.
- Transition must be allowed by capacity rules.
- Capacity must be in mutable state (not already transitioning).

## 2. Pause/Resume
- Pause allowed only when capacity is running and eligible.
- Resume allowed only when capacity is paused.
- Preflight includes expected impact warnings for active workloads.

## 3. Workspace Move (Same Geography)
- Destination capacity geography must match source geography.
- Destination capacity must be healthy and accept assignments.
- User must have required admin rights for both capacities/workspace.

## 4. Workspace Move (Cross-Region) _(removed)_
- Destination geography must differ from source.
- Every item in workspace must pass cross-region support checks.
- Any unsupported item blocks submit and returns detailed messages.

## Cross-Region Support Matrix (Model) _(removed)_

```ts
export interface ItemMoveSupport {
  itemType: string;
  supportsCrossRegion: boolean;
  notes?: string;
}

export interface WorkspaceCrossRegionEligibility {
  workspaceId: string;
  isEligible: boolean;
  supportedItems: { itemId: string; itemType: string }[];
  unsupportedItems: { itemId: string; itemType: string; reason: string }[];
}
```

## UI Action Flows

## Shared UX Pattern
- Entry point: Admin actions menu on capacity/workspace nodes.
- Step 1: Action form (target values).
- Step 2: Preflight panel (messages + impact summary).
- Step 3: Confirmation dialog (explicit action text).
- Step 4: Progress panel (queued/in progress).
- Step 5: Final state panel (success/failure details and timestamps).

## Flow A: Scale Capacity Up/Down
1. User selects capacity and target SKU.
2. Client calls preflight with `capacity.scale`.
3. If blocked, show errors and stop.
4. If allowed, user confirms.
5. Client submits operation and polls status.
6. On success, refresh capacities and regroup UI if SKU badge changed.

## Flow B: Pause/Resume Capacity
1. User selects pause or resume on a capacity.
2. Client calls preflight for selected action.
3. UI shows impact warning (pause) or readiness notes (resume).
4. User confirms and submit is sent.
5. Client polls until terminal state and refreshes capacity status.

## Flow C: Move Workspace (Same Geography)
1. User chooses destination from same-geo list.
2. Client preflights `workspace.move.sameGeo`.
3. If allowed, user confirms move.
4. Client submits and polls operation status.
5. On success, workspace tree reloads and workspace appears under destination capacity.

## Flow D: Move Workspace (Cross-Region) _(removed)_
1. User selects cross-region destination.
2. Client preflights `workspace.move.crossRegion`.
3. UI shows eligibility report with unsupported items if any.
4. If unsupported items exist, submit remains disabled.
5. If eligible, user confirms impact notice and submits.
6. Client polls status and updates workspace grouping on success.

## Error Handling Contract

- Every error response should include:
  - stable `code`
  - human-readable `message`
  - `correlationId`
- UI maps known codes to actionable remediation text.
- Unknown codes fallback to generic failure message with correlation ID.

## Suggested Error Codes

- `AUTH_FORBIDDEN`
- `CAPACITY_STATE_INVALID`
- `SKU_TRANSITION_INVALID`
- `DESTINATION_UNAVAILABLE`
- `GEOGRAPHY_MISMATCH`
- `CROSS_REGION_ITEM_UNSUPPORTED`
- `OPERATION_CONFLICT`
- `OPERATION_TIMEOUT`

## Observability and Audit

Minimum audit fields for each operation attempt:
- Actor
- Operation type
- Source/target resource IDs
- Preflight decision
- Submit decision
- Final outcome
- Correlation ID

## Security Constraints

- Admin Mode must not elevate permissions beyond signed-in user rights.
- All mutating actions require explicit user confirmation.
- Client must treat all server-side validation as authoritative.

## Implementation Notes for Current Codebase

- Keep API wrappers in [src/api/fabricApi.ts](../src/api/fabricApi.ts).
- Add Admin operation types in [src/types.ts](../src/types.ts).
- Add Admin mode and operations state in [src/hooks/useFabricData.ts](../src/hooks/useFabricData.ts).
- Add UI actions in [src/components/WorkspaceTree.tsx](../src/components/WorkspaceTree.tsx) and optionally a dedicated admin actions component.
- Keep filtering UI in [src/components/FiltersPanel.tsx](../src/components/FiltersPanel.tsx) focused on browse concerns; avoid overloading it with destructive actions.

## Live Execution Wiring

Each slice's `preflight` is real (local) validation. The `submit`/`poll` half
dispatches on the `VITE_ADMIN_LIVE_WRITES` flag
([src/admin/core/featureFlags.ts](../src/admin/core/featureFlags.ts)):

- **Off (default):** `simulateSubmit` / `simulatePoll` in
  [src/admin/core/adminClient.ts](../src/admin/core/adminClient.ts) complete the
  lifecycle locally.
- **On:** [src/admin/core/liveClient.ts](../src/admin/core/liveClient.ts) calls
  the real control planes:
  - **Scale** → `PATCH https://management.azure.com{armId}?api-version=2023-11-01`
    with `{ sku: { name, tier: "Fabric" } }`.
  - **Pause / Resume** → `POST {armId}/suspend` · `{armId}/resume`
    (api-version `2023-11-01`).
  - **Workspace move** → `POST https://api.fabric.microsoft.com/v1/workspaces/{id}/assignToCapacity`
    with `{ capacityId }`.
  - ARM ids are resolved by `findCapacityArmId` (enumerates subscriptions and
    matches the capacity by name, since the Fabric capacities API omits ARM ids).
  - Long-running operations are tracked in a registry and polled via the
    `Azure-AsyncOperation` / `Location` header until terminal.

Required scopes live in [src/authConfig.ts](../src/authConfig.ts)
(`azureArmScopes`, `fabricWriteScopes`) and are acquired on demand by the shared
`TokenProvider`. See the README for the Entra permissions and capacity RBAC
needed to enable live writes.
