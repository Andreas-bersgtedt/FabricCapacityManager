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
