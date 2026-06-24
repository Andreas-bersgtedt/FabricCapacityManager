# Quickstart — Set up & authorize Fabric Capacity Manager

This guide walks you **start to finish** through registering and authorizing the
Microsoft Entra application that lets **Fabric Capacity Manager** sign in and
read your Microsoft Fabric workspaces, items and capacities.

By the end you will have:

1. A Microsoft Entra **app registration** (single-page application).
2. A **redirect URI** that matches the local dev server.
3. **Delegated API permissions** for the Fabric and Power BI REST APIs.
4. **Admin consent** granted (or per-user consent on first sign-in).
5. Tenant settings enabled so the APIs return data.
6. The app running locally and listing your workspaces.

> **Time:** ~10 minutes · **You need:** rights to create an app registration in
> your tenant. Granting *admin consent* and toggling *tenant settings* require a
> Global Administrator / Fabric Administrator (or someone who can do it for you).

---

## Concepts in 30 seconds

- This is a **public client SPA** — there is **no client secret**. The browser
  signs the user in interactively (OAuth 2.0 **Authorization Code flow with
  PKCE**) using **MSAL.js**.
- The app uses **delegated permissions** — it acts *as the signed-in user*, so
  it only ever sees workspaces/items that user already has access to.
- Two resources are called, each needing its own token:
  - **Microsoft Fabric API** → workspaces, items, capacities.
  - **Power BI Service API** → semantic-model storage mode.

📖 References:
[Authentication & authorization basics](https://learn.microsoft.com/entra/identity-platform/authentication-vs-authorization) ·
[Single-page app scenario](https://learn.microsoft.com/entra/identity-platform/scenario-spa-overview) ·
[Auth code flow + PKCE](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)

---

## Step 1 — Register the application

1. Sign in to the **[Microsoft Entra admin center](https://entra.microsoft.com)**
   → **Identity → Applications → App registrations → + New registration**.
2. **Name:** `Fabric Capacity Manager (dev)`.
3. **Supported account types:** *Accounts in this organizational directory only
   (Single tenant)*.
4. **Redirect URI:** choose platform **Single-page application (SPA)** and enter:

   ```
   http://localhost:5173
   ```

5. Click **Register**.
6. On the **Overview** page, copy these two values — you'll need them in Step 4:
   - **Application (client) ID**
   - **Directory (tenant) ID**

📖 References:
[Quickstart: Register an app](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app) ·
[Configure a SPA redirect URI](https://learn.microsoft.com/entra/identity-platform/scenario-spa-app-registration) ·
[Redirect URI restrictions](https://learn.microsoft.com/entra/identity-platform/reply-url)

> ✅ The redirect URI **must** be added under the **Single-page application**
> platform (not Web). If you change the dev port, update both
> [vite.config.ts](vite.config.ts) and this redirect URI.

---

## Step 2 — Add delegated API permissions

Go to your app → **API permissions → + Add a permission**, then add the
following **Delegated permissions**.

### 2a. Microsoft Fabric (Power Platform / Fabric API)

Search for **Power BI Service** *and* the **Microsoft Fabric** API surface. Add:

| API               | Delegated permission   | Why                                  |
| ----------------- | ---------------------- | ------------------------------------ |
| Microsoft Fabric  | `Workspace.Read.All`   | List workspaces                      |
| Microsoft Fabric  | `Item.Read.All`        | List items (Lakehouse, Warehouse, …) |
| Microsoft Fabric  | `Capacity.Read.All`    | Read capacity SKU / region / name    |

### 2b. Power BI Service

| API              | Delegated permission   | Why                                          |
| ---------------- | ---------------------- | -------------------------------------------- |
| Power BI Service | `Workspace.Read.All`   | Resolve workspace ↔ group for datasets       |
| Power BI Service | `Dataset.Read.All`     | Read `targetStorageMode` (Large vs Small)    |

> ℹ️ **Why two APIs?** The Fabric API provides workspaces, items and capacities.
> The Power BI API exposes each semantic model's `targetStorageMode`
> (`PremiumFiles` = *Large dataset storage format*), which the Fabric API does
> not surface. See the storage-mode logic in
> [src/api/fabricApi.ts](src/api/fabricApi.ts).

The exact scope strings the app requests are defined in
[src/authConfig.ts](src/authConfig.ts):

```text
https://api.fabric.microsoft.com/Workspace.Read.All
https://api.fabric.microsoft.com/Item.Read.All
https://api.fabric.microsoft.com/Capacity.Read.All
https://analysis.windows.net/powerbi/api/Workspace.Read.All
https://analysis.windows.net/powerbi/api/Dataset.Read.All
```

📖 References:
[Update an app's requested permissions](https://learn.microsoft.com/entra/identity-platform/howto-update-permissions) ·
[Fabric REST API – identity & scopes](https://learn.microsoft.com/rest/api/fabric/articles/identity-support) ·
[Power BI REST API permissions](https://learn.microsoft.com/rest/api/power-bi/) ·
[Delegated vs application permissions](https://learn.microsoft.com/entra/identity-platform/permissions-consent-overview)

---

## Step 3 — Grant consent

Delegated permissions need consent before tokens are issued.

- **Option A (recommended): Tenant-wide admin consent.** On the **API
  permissions** page click **Grant admin consent for \<tenant\>**. All columns
  should turn green ✔️.
- **Option B: Per-user consent.** Skip admin consent and let each user consent
  in the sign-in popup the first time they use the app. This only works if your
  tenant allows users to consent to these permissions.

📖 References:
[Grant tenant-wide admin consent](https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent) ·
[User & admin consent overview](https://learn.microsoft.com/entra/identity/enterprise-apps/user-admin-consent-overview) ·
[Configure the consent prompt](https://learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent)

---

## Step 4 — Enable the tenant settings (so the APIs return data)

Even with consent, the service-side switches must be on. As a **Fabric / Power BI
administrator** open the **[Fabric Admin portal](https://app.fabric.microsoft.com/admin-portal)**
→ **Tenant settings → Developer settings** and enable:

- **Users can use Fabric APIs** (or *Service principals/users can use Fabric
  APIs*) — required for the Fabric REST API.
- **Allow user access to the Power BI REST APIs** (under *Developer settings*) —
  required for the Power BI datasets call.

Scope each setting to the whole org or to a security group that includes your
users. Settings can take a few minutes to apply.

📖 References:
[About tenant settings](https://learn.microsoft.com/fabric/admin/about-tenant-settings) ·
[Developer tenant settings](https://learn.microsoft.com/fabric/admin/service-admin-portal-developer) ·
[Power BI: Allow access to REST APIs](https://learn.microsoft.com/power-bi/admin/service-admin-portal-developer)

---

## Step 5 — Configure & run the app

1. Copy the environment template and fill in the IDs from Step 1:

   ```powershell
   copy .env.example .env
   ```

   ```ini
   VITE_AAD_CLIENT_ID=<Application (client) ID>
   VITE_AAD_TENANT_ID=<Directory (tenant) ID>
   ```

2. Install and start the dev server:

   ```powershell
   npm install
   npm run dev
   ```

3. Open <http://localhost:5173> → **Sign in** (complete the OAuth popup) →
   **Load workspaces**.

> 🔐 On first use you may see **two** consent prompts (one per resource: Fabric,
> then Power BI) unless admin consent was granted in Step 3. After consenting,
> tokens are acquired silently.

📖 References:
[MSAL.js for SPAs](https://learn.microsoft.com/entra/identity-platform/tutorial-single-page-app-react-prepare-app) ·
[Acquire tokens (MSAL browser)](https://learn.microsoft.com/entra/identity-platform/scenario-spa-acquire-token)

---

## What the app calls

| Data shown        | API call                                                          |
| ----------------- | ----------------------------------------------------------------- |
| Region, SKU, name | `GET https://api.fabric.microsoft.com/v1/capacities`              |
| Workspaces        | `GET https://api.fabric.microsoft.com/v1/workspaces`              |
| Item types        | `GET https://api.fabric.microsoft.com/v1/workspaces/{id}/items`   |
| Storage mode      | `GET https://api.powerbi.com/v1.0/myorg/groups/{id}/datasets`     |

📖 API reference:
[List Capacities](https://learn.microsoft.com/rest/api/fabric/core/capacities/list-capacities) ·
[List Workspaces](https://learn.microsoft.com/rest/api/fabric/core/workspaces/list-workspaces) ·
[List Items](https://learn.microsoft.com/rest/api/fabric/core/items/list-items) ·
[Power BI – Get Datasets In Group](https://learn.microsoft.com/rest/api/power-bi/datasets/get-datasets-in-group)

---

## Troubleshooting

| Symptom | Likely cause & fix |
| --- | --- |
| Popup completes but UI doesn't change | Mixed-resource login scopes. The app already requests a single resource at login; ensure you're on the latest code and check the browser console (F12). |
| `AADSTS650053` / scope errors | The permission isn't added or consented. Re-check **Steps 2–3**. |
| `AADSTS50011` redirect mismatch | Redirect URI not registered as **SPA** or the port differs. Re-check **Step 1**. |
| Sign-in works, but **0 workspaces** | Tenant developer settings disabled (**Step 4**), or the user genuinely has no workspace access. |
| Storage mode always **"No semantic model"** | Power BI `Dataset.Read.All` not consented or the Power BI REST API tenant setting is off. |
| `403 Forbidden` on Fabric calls | *Users can use Fabric APIs* tenant setting is off, or not scoped to your group. |

📖 References:
[Entra sign-in error codes (AADSTS)](https://learn.microsoft.com/entra/identity-platform/reference-error-codes) ·
[Fabric REST API troubleshooting](https://learn.microsoft.com/rest/api/fabric/articles/troubleshooting)

---

## Security notes

- No client secret is stored — this is a **public client**; tokens live in the
  browser's `sessionStorage` only (see [src/authConfig.ts](src/authConfig.ts)).
- The app is **read-only**: every permission is a `*.Read.All` delegated scope.
- Keep `.env` out of source control (it's already in [.gitignore](.gitignore)).

For the full feature overview and developer notes, see the [README](README.md).
