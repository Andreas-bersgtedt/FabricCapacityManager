# Fabric Capacity Manager

A **local dev-mode single-page app** that signs in to a Microsoft Fabric tenant
with an OAuth web dialog (MSAL popup) and lists all workspaces you have access
to, grouped by:

**Region › Capacity SKU › Capacity Name**

You can filter the workspaces by:

- **Storage mode** — Large dataset / Small dataset / No semantic model
  (derived from each semantic model's `targetStorageMode`).
- **Item presence** — show only workspaces that contain selected Fabric item
  types (Warehouse, Lakehouse, Eventhouse, KQL Database, Notebook, etc.).
- **Name search**.

## Tech stack

- Vite + React + TypeScript
- `@azure/msal-browser` + `@azure/msal-react` for delegated (user) auth
- Fabric REST API (`api.fabric.microsoft.com`) for workspaces, items, capacities
- Power BI REST API (`api.powerbi.com`) for semantic-model storage mode

## 1. Register an Entra application (one-time)

1. Go to **Microsoft Entra admin center › App registrations › New registration**.
2. Name it e.g. `Fabric Capacity Manager (dev)`.
3. Supported account types: **Accounts in this organizational directory only**.
4. **Redirect URI** → platform **Single-page application (SPA)** →
   `http://localhost:5173`.
5. Register, then copy the **Application (client) ID** and **Directory (tenant) ID**.
6. Under **API permissions › Add a permission**, add delegated permissions:
   - **Power BI Service**: `Workspace.Read.All`, `Dataset.Read.All`,
     `Capacity.Read.All`
   - **Microsoft Fabric** (Power Platform Fabric API): `Workspace.Read.All`,
     `Item.Read.All`, `Capacity.Read.All`
   - Click **Grant admin consent** (or consent on first sign-in).

> Tenant admins must also enable **"Service principals/users can use Fabric APIs"**
> and Power BI **"Allow user access to REST APIs"** in the tenant admin settings.

## 2. Configure the app

```powershell
copy .env.example .env
```

Edit `.env`:

```
VITE_AAD_CLIENT_ID=<your application (client) id>
VITE_AAD_TENANT_ID=<your directory (tenant) id>
```

## 3. Run locally

```powershell
npm install
npm run dev
```

Open <http://localhost:5173>, click **Sign in**, complete the popup, then
**Load workspaces**.

> The dev server port (`5173`) must match the SPA redirect URI you registered.
> To change it, update both `vite.config.ts` and the app registration.

## 4. Build

```powershell
npm run build
npm run preview
```

## How the data is assembled

| Field           | Source                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Region, SKU     | `GET /v1/capacities` (Fabric), joined by `capacityId`                  |
| Capacity Name   | `GET /v1/capacities` → `displayName`                                    |
| Workspaces      | `GET /v1/workspaces` (Fabric)                                           |
| Item types      | `GET /v1/workspaces/{id}/items` (Fabric)                               |
| Storage mode    | `GET /v1.0/myorg/groups/{id}/datasets` → `targetStorageMode` (Power BI) |

`targetStorageMode == "PremiumFiles"` is treated as **Large** dataset storage
format. Workspaces with no semantic models report **No semantic model**.

## Notes & limitations

- Only workspaces and capacities the signed-in user can access are returned.
- Storage mode requires Power BI read permission; if it can't be read for a
  workspace it is reported as "No semantic model".
- Item and dataset details are fetched per workspace with bounded concurrency,
  so the initial load can take a moment on large tenants.
