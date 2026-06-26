/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AAD_CLIENT_ID: string;
  readonly VITE_AAD_TENANT_ID: string;
  /** "true" enables live Admin Mode write operations (ARM / Fabric). */
  readonly VITE_ADMIN_LIVE_WRITES?: string;
  /** Optional override for the Azure Retail Prices endpoint/proxy path. */
  readonly VITE_RETAIL_PRICES_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
