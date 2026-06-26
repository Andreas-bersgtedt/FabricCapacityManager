// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: public module surface. Import slices and core from here.
//
// Structure (vertical slices):
//   core/   - operation lifecycle, admin-mode gating, shared dialog UI
//   slices/ - one self-contained folder per admin operation:
//             scaleCapacity, pauseResumeCapacity,
//             moveWorkspaceSameGeo, moveWorkspaceCrossRegion

export * from "./core/adminTypes";
export * from "./core/adminClient";
export * from "./core/featureFlags";
export * from "./core/liveClient";
export * from "./core/geography";
export * from "./core/useAdminOperation";
export * from "./core/AdminModeContext";
export * from "./core/components/ConfirmDialog";
export * from "./core/components/PreflightPanel";
export * from "./core/components/OperationStatusView";

export * from "./slices/scaleCapacity";
export * from "./slices/pauseResumeCapacity";
export * from "./slices/moveWorkspaceSameGeo";
export * from "./slices/moveWorkspaceCrossRegion";
