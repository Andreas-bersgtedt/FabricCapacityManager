// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: build-time feature flags.

/**
 * When true, admin write operations call the real Azure Resource Manager /
 * Fabric endpoints. When false (the default) they run against a local
 * simulation so the UI can be exercised without management-plane access.
 *
 * Enable by setting `VITE_ADMIN_LIVE_WRITES=true` in `.env`. The Entra app
 * registration must also have the Azure Service Management + Fabric ReadWrite
 * permissions consented, and the signed-in user must hold the required RBAC on
 * the target capacities.
 */
export const adminLiveWrites =
  import.meta.env.VITE_ADMIN_LIVE_WRITES === "true";

/**
 * Ingestion endpoint for the durable remote audit sink. When set, every admin
 * audit event is POSTed here (in addition to the local store) so the record is
 * retained centrally. Leave empty to keep audit local-only.
 *
 * Set `VITE_AUDIT_REMOTE_URL` to a collector that accepts an `AuditEvent` JSON
 * body (e.g. an Azure Function forwarding to Application Insights / table
 * storage).
 */
export const auditRemoteUrl = (
  import.meta.env.VITE_AUDIT_REMOTE_URL ?? ""
).trim();

/**
 * Optional Entra scope requested for the bearer token attached to audit-sink
 * POSTs. Leave empty for an unauthenticated collector.
 */
export const auditRemoteScope = (
  import.meta.env.VITE_AUDIT_REMOTE_SCOPE ?? ""
).trim();
