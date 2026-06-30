# Audit Collector

A small Azure Functions (Node.js, TypeScript, v4 programming model) app that
receives **admin audit events** from Fabric Capacity Manager and stores them
durably and centrally. It is the server-side backend for the client's remote
audit sink (`src/admin/core/remoteAuditSink.ts`).

```
Browser SPA ──POST /api/audit (Bearer token)──▶ auditCollector
                                                  │  validate Entra JWT
                                                  │  validate AuditEvent
                                                  ├─▶ Application Insights (trace)
                                                  └─▶ Azure Table Storage (entity)
```

## Endpoint

`POST /api/audit`

- **Auth:** Entra ID bearer token in the `Authorization` header. The function is
  `anonymous` at the platform level so the SPA can call it directly; identity is
  enforced in code by verifying the JWT signature (tenant JWKS), issuer and
  audience.
- **Body:** a JSON `AuditEvent` (see `src/auditEvent.ts`, kept in sync with the
  client's `src/admin/core/adminTypes.ts`).
- **Responses:** `202 Accepted` on success; `400` malformed body; `401`
  missing/invalid token; `500` collector not configured; `502` persistence
  failure.

The server overwrites `actorObjectId` with the `oid`/`sub` from the verified
token, so the client-supplied actor is never trusted for identity.

## Configuration

| Setting | Required | Purpose |
| --- | --- | --- |
| `AUDIT_TENANT_ID` | yes* | Entra tenant GUID used to build the JWKS + issuer. |
| `AUDIT_AUDIENCE` | yes* | Expected token audience (the collector app's `api://<id>` or client id). |
| `AUDIT_TABLE_ACCOUNT_URL` | no | Table service endpoint (e.g. `https://<acct>.table.core.windows.net/`). Used for keyless access via managed identity. |
| `AUDIT_TABLE_CONNECTION_STRING` | no | Storage connection string for local dev (Azurite). Takes precedence over `AUDIT_TABLE_ACCOUNT_URL`. |
| `AUDIT_TABLE_NAME` | no | Table name (default `AuditEvents`). |
| `AUDIT_ALLOW_ANONYMOUS` | no | `true` disables auth (**local development only**). |

\* Required unless `AUDIT_ALLOW_ANONYMOUS=true`. The collector refuses to run in
an unauthenticated state by default (returns `500`) to avoid an open audit sink.

If neither `AUDIT_TABLE_ACCOUNT_URL` nor `AUDIT_TABLE_CONNECTION_STRING` is set,
events are logged to Application Insights but not persisted to a table.

## Client wiring

Point the SPA at this collector via its build-time env vars:

```
VITE_AUDIT_REMOTE_URL=https://<func-app>.azurewebsites.net/api/audit
VITE_AUDIT_REMOTE_SCOPE=api://<collector-app-registration-id>/.default
```

## Local development

```powershell
cd collector
npm install
Copy-Item local.settings.json.example local.settings.json
# edit local.settings.json with your tenant/audience (or set AUDIT_ALLOW_ANONYMOUS=true)
npm start
```

Requires the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
and (for `UseDevelopmentStorage=true`) [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite).

## Deploy

### Option A: provision with Bicep (recommended)

The `infra/` template provisions a fully **keyless** stack: a Flex Consumption
Function App with a system-assigned managed identity, a storage account with
shared-key access disabled, Log Analytics + Application Insights, and the
least-privilege role assignments (`Storage Blob Data Owner` for the host,
`Storage Table Data Contributor` for the audit table). No keys or connection
strings are created.

```powershell
cd collector
# 1. Edit infra/main.bicepparam: set `audience` and `allowedOrigins`.
az group create -n <resource-group> -l <location>
az deployment group create -g <resource-group> -f infra/main.bicep -p infra/main.bicepparam

# 2. Publish the code to the provisioned app (name is a deployment output).
npm run build
func azure functionapp publish <functionAppName-from-output>
```

The deployment outputs `auditEndpoint` (use it for `VITE_AUDIT_REMOTE_URL`),
`functionAppName`, `storageAccountName`, and `appInsightsName`. App settings and
CORS are configured by the template, so no manual portal steps are required.

### Option B: publish to an existing app

```powershell
npm run build
func azure functionapp publish <func-app-name>
```

When targeting your own app, configure the settings above and the Function App
**CORS** allowed origin, and grant the app's managed identity
`Storage Table Data Contributor` on the storage account so `AUDIT_TABLE_ACCOUNT_URL`
works without keys.
