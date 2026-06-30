/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AAD_CLIENT_ID: string;
  readonly VITE_AAD_TENANT_ID: string;
  /** "true" enables live Admin Mode write operations (ARM / Fabric). */
  readonly VITE_ADMIN_LIVE_WRITES?: string;
  /** Ingestion endpoint that receives admin audit events (durable remote sink). */
  readonly VITE_AUDIT_REMOTE_URL?: string;
  /** Optional Entra scope requested when authenticating audit-sink POSTs. */
  readonly VITE_AUDIT_REMOTE_SCOPE?: string;
  /** Optional override for the Azure Retail Prices endpoint/proxy path. */
  readonly VITE_RETAIL_PRICES_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
