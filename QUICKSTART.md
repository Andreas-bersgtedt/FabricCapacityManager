# Quickstart: Set up and authorize Fabric Capacity Manager

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

- This is a **public client SPA** with **no client secret**. The browser
  signs the user in interactively (OAuth 2.0 **Authorization Code flow with
  PKCE**) using **MSAL.js**.
- The app uses **delegated permissions**: it acts *as the signed-in user*, so
  it only ever sees workspaces/items that user already has access to.
- Two resources are called, each needing its own token:
  - **Microsoft Fabric API** → workspaces, items, capacities.
  - **Power BI Service API** → semantic-model storage mode.

📖 References:
[Authentication & authorization basics](https://learn.microsoft.com/entra/identity-platform/authentication-vs-authorization) ·
[Single-page app scenario](https://learn.microsoft.com/entra/identity-platform/scenario-spa-overview) ·
[Auth code flow + PKCE](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow)

---

## Step 1: Register the application

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
6. On the **Overview** page, copy these two values; you'll need them in Step 4:
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

## Step 2: Add delegated API permissions

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

### 2c. Optional: Admin Mode live writes (Preview)

The read permissions above are **all you need** for the default, read-only app
(inventory, dashboard, cost estimates and OneLake storage). Add the following
**only** if you intend to enable live **Admin Mode** writes
(`VITE_ADMIN_LIVE_WRITES=true`). They span two control planes:

| API                      | Delegated permission        | Why                                               |
| ------------------------ | --------------------------- | ------------------------------------------------- |
| Azure Service Management | `user_impersonation`        | Scale, pause and resume capacities via ARM        |
| Microsoft Fabric         | `Capacity.ReadWrite.All`    | Reassign workspaces to a capacity                 |
| Microsoft Fabric         | `Workspace.ReadWrite.All`   | Reassign workspaces to a capacity                 |

The scope strings the app requests on demand (from
[src/authConfig.ts](src/authConfig.ts)) are:

```text
https://management.azure.com/.default
https://api.fabric.microsoft.com/Capacity.ReadWrite.All
https://api.fabric.microsoft.com/Workspace.ReadWrite.All
```

> ℹ️ Consenting to a permission is **not** authorization. For ARM operations the
> signed-in user must also hold the matching **Azure RBAC** actions on the
> target `Microsoft.Fabric/capacities` resources, and for the workspace move
> they must be a **workspace admin** and a **contributor on the destination
> capacity**. See the access reference below.

📖 References:
[Update an app's requested permissions](https://learn.microsoft.com/entra/identity-platform/howto-update-permissions) ·
[Fabric REST API – identity & scopes](https://learn.microsoft.com/rest/api/fabric/articles/identity-support) ·
[Azure RBAC overview](https://learn.microsoft.com/azure/role-based-access-control/overview) ·
[Azure custom roles](https://learn.microsoft.com/azure/role-based-access-control/custom-roles)

### Access reference: everything the app can require

| Capability | Plane | Endpoint(s) | Delegated scope | Authorization (RBAC / role) |
| --- | --- | --- | --- | --- |
| List capacities (region, SKU, name, state) | Fabric REST | `GET /v1/capacities` | `Capacity.Read.All` | Member of / access to the capacity |
| List workspaces | Fabric REST | `GET /v1/workspaces` | `Workspace.Read.All` | Workspace access (any role) |
| List items | Fabric REST | `GET /v1/workspaces/{id}/items` | `Item.Read.All` | Workspace access (any role) |
| Storage mode | Power BI REST | `GET /v1.0/myorg/groups/{id}/datasets` | Power BI `Dataset.Read.All` (+ `Workspace.Read.All`) | Workspace access |
| Cost estimate | Public (Azure Retail Prices) | `GET prices.azure.com/api/retail/prices` | none (anonymous) | none |
| OneLake storage (opt-in) | Power BI REST | `POST .../datasets/{id}/executeQueries` | Power BI `Dataset.Read.All` | Read access to the Capacity Metrics model |
| Scale capacity (Preview) | Azure ARM | `PATCH /subscriptions/{sub}/providers/Microsoft.Fabric/capacities/{name}` (sku) | `management.azure.com/.default` | `Microsoft.Fabric/capacities/write` |
| Pause / resume capacity (Preview) | Azure ARM | `POST .../capacities/{name}/suspend` · `.../resume` | `management.azure.com/.default` | `.../capacities/suspend/action` · `.../capacities/resume/action` |
| Resolve ARM id / tags (for Admin Mode) | Azure ARM | `GET /subscriptions` · `GET .../Microsoft.Fabric/capacities` | `management.azure.com/.default` | `Microsoft.Fabric/capacities/read` + subscription reader |
| Move workspace to capacity (Preview) | Fabric REST | `POST /v1/workspaces/{id}/assignToCapacity` | Fabric `Capacity.ReadWrite.All`, `Workspace.ReadWrite.All` | Workspace **admin** + **contributor** on destination capacity |

> A custom Azure role scoped to the four `Microsoft.Fabric/capacities` actions
> (`read`, `write`, `suspend/action`, `resume/action`) on the target capacities
> (or their resource group) is sufficient for the ARM operations.

---

## Step 3: Grant consent

Delegated permissions need consent before tokens are issued.

- **Option A (recommended): Tenant-wide admin consent.** On the **API
  permissions** page click **Grant admin consent for \<tenant\>**. All columns
  should turn green ✔️.
- **Option B: Per-user consent.** Skip admin consent and let each user consent
  in the sign-in popup the first time they use the app. This only works if your
  tenant allows users to consent to these permissions.

> If you added the optional **Admin Mode (2c)** permissions, consent them here
> too. The ARM `user_impersonation` and Fabric `*.ReadWrite.All` scopes are
> requested on demand the first time you run a live write, so you may see an
> extra consent prompt then unless admin consent was already granted.

📖 References:
[Grant tenant-wide admin consent](https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent) ·
[User & admin consent overview](https://learn.microsoft.com/entra/identity/enterprise-apps/user-admin-consent-overview) ·
[Configure the consent prompt](https://learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent)

---

## Step 4: Enable the tenant settings (so the APIs return data)

Even with consent, the service-side switches must be on. As a **Fabric / Power BI
administrator** open the **[Fabric Admin portal](https://app.fabric.microsoft.com/admin-portal)**
→ **Tenant settings → Developer settings** and enable:

- **Users can use Fabric APIs** (or *Service principals/users can use Fabric
  APIs*), required for the Fabric REST API.
- **Allow user access to the Power BI REST APIs** (under *Developer settings*),
  required for the Power BI datasets call.

Scope each setting to the whole org or to a security group that includes your
users. Settings can take a few minutes to apply.

📖 References:
[About tenant settings](https://learn.microsoft.com/fabric/admin/about-tenant-settings) ·
[Developer tenant settings](https://learn.microsoft.com/fabric/admin/service-admin-portal-developer) ·
[Power BI: Allow access to REST APIs](https://learn.microsoft.com/power-bi/admin/service-admin-portal-developer)

---

## Step 5: Configure and run the app

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

   Or use the clean-start helper, which frees the dev port, reinstalls
   dependencies and launches the server:

   ```powershell
   ./start.ps1
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
| Cost estimate     | `GET https://prices.azure.com/api/retail/prices` (no auth)        |
| OneLake storage (opt-in) | `POST https://api.powerbi.com/v1.0/myorg/groups/{id}/datasets/{id}/executeQueries` |

> The **cost estimate** call is an anonymous public API; no token or consent
> needed. The opt-in **OneLake storage** call reuses the Power BI
> `Dataset.Read.All` scope you already consented to in Step 2 (no extra
> permission), and requires the **Microsoft Fabric Capacity Metrics** app to be
> installed and visible to you.

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
| **OneLake storage** won't load | The Capacity Metrics app isn't installed/visible to you, or auto-discovery couldn't match the model; use **Show model schema** and supply a custom `EVALUATE` query in Configuration. |
| `403 Forbidden` on Fabric calls | *Users can use Fabric APIs* tenant setting is off, or not scoped to your group. |

📖 References:
[Entra sign-in error codes (AADSTS)](https://learn.microsoft.com/entra/identity-platform/reference-error-codes) ·
[Fabric REST API troubleshooting](https://learn.microsoft.com/rest/api/fabric/articles/troubleshooting)

---

## Security notes

- No client secret is stored; this is a **public client**, and tokens live in the
  browser's `sessionStorage` only (see [src/authConfig.ts](src/authConfig.ts)).
- As set up in this guide the app is **read-only**: every permission is a
  `*.Read.All` delegated scope. Live **Admin Mode** writes are off by default
  and require extra opt-in permissions; see the README for details.
- Keep `.env` out of source control (it's already in [.gitignore](.gitignore)).

For the full feature overview and developer notes, see the [README](README.md).

---

## Disclaimer of warranty and limitation of liability

THIS SOFTWARE AND THIS GUIDE ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT
WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
NON-INFRINGEMENT. The authors and copyright holders make no representation or
warranty that the software or instructions are accurate, complete, reliable,
secure, current, or error-free.

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE AUTHORS
OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY
(INCLUDING WITHOUT LIMITATION ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES, LOSS OF DATA, LOSS OF PROFITS, OR BUSINESS
INTERRUPTION) ARISING IN ANY WAY OUT OF THE USE OF, OR INABILITY TO USE, THIS
SOFTWARE OR GUIDE, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Configuring app registrations, API permissions, consent, and tenant settings
affects your organization's security posture. **You are solely responsible** for
reviewing, approving, and auditing any changes you make by following this guide,
and for ensuring they comply with your organization's policies and the terms
governing the Microsoft services and APIs involved. This project is an
independent, community-built tool and is **not** an official Microsoft product,
nor endorsed by, affiliated with, or supported by Microsoft Corporation.
