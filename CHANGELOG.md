# Changelog

All notable changes to **Fabric Capacity Manager** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-28

### Added

- **Access self-test.** On sign-in the app automatically lists every delegated
  permission it relies on — for both standard (read) and admin (write) mode —
  and probes each one to verify the signed-in user actually has the right, not
  just consent. Surfaced as a panel in the Configuration tab and a status pill
  in the header, with manual re-run and an interactive "Grant access" flow.
- **Capacity run-state badge.** Each capacity in the Detail tree now shows its
  current state (Running / Paused).

### Changed

- **Cost reflects a current monthly cost rate.** Only running capacities accrue
  compute cost; paused/suspended capacities are now excluded from the
  per-capacity, per-region and Dashboard cost roll-ups. The Dashboard KPI was
  renamed to "Monthly cost rate" and notes how many capacities are running.

## [0.1.0] - 2026-06-26

Initial development release: a local single-page app to explore Microsoft
Fabric workspaces grouped by Region › Capacity SKU › Capacity Name.

### Added

- **Authentication.** MSAL-based sign-in (Entra app registration) with delegated
  Fabric and Power BI scopes; tokens acquired silently with interactive fallback.
- **Workspace explorer.** Collapsible three-level tree (Region › SKU › Capacity)
  with per-workspace storage mode, item types, role and capacity region.
- **Dashboard tab.** Tenant-wide aggregated view: KPI cards (workspaces,
  capacities, items, regions, SKUs, estimated cost, OneLake storage) plus
  distribution breakdowns by region, SKU, capacity state, storage mode and item
  type.
- **Cost estimates.** Per-capacity and per-region estimated monthly compute cost
  derived from the public Azure Retail Prices API, with a configurable display
  currency. Includes a proxy to work around API CORS limitations.
- **OneLake storage (opt-in).** Per-workspace current/billable/cache storage read
  from the Fabric Capacity Metrics app semantic model via the Power BI
  `executeQueries` API, with auto-discovery, schema introspection and custom DAX.
- **Admin Mode (preview).** Role-gated, opt-in write operations implemented as
  vertical slices with preflight validation: scale capacity, pause/resume
  capacity, move workspace within a geography, and cross-region workspace move
  (with item eligibility checks). Executes against a local simulation by default;
  live Azure Resource Manager / Fabric REST execution is gated behind the
  `VITE_ADMIN_LIVE_WRITES` feature flag.
- **Capacity metadata.** Azure resource tags and workspace governance domain
  surfaced in the tree; capacity metadata refreshes incrementally after a
  successful admin operation.
- **Excel export** of the loaded workspaces.
- **Configuration tab** for account, currency and OneLake storage settings.
- **Tooling.** `start.ps1` to clean-install dependencies and run the dev server.

### Documentation

- README, quickstart (Entra app registration and authorization), Admin Mode
  roadmap and implementation specs, full Fabric and Azure ARM access
  requirements, and a warranty/liability disclaimer.

[Unreleased]: https://github.com/anbergst_microsoft/FabricCapacityManager/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/anbergst_microsoft/FabricCapacityManager/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/anbergst_microsoft/FabricCapacityManager/releases/tag/v0.1.0
