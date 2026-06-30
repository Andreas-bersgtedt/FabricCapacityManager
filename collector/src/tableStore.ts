// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Audit collector: durable persistence to Azure Table Storage.
//
// Each audit event becomes one table entity. Object-valued fields (targetIds,
// details) are stored as JSON strings because Table Storage entities are flat.
// The append-only key scheme (operationType partition, timestamp+correlation
// row) gives a stable, queryable, tamper-evident record.

import { TableClient, type TableEntity } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { AuditEvent } from "./auditEvent";

export interface PersistenceConfig {
  /** Connection string for local development (e.g. Azurite). */
  connectionString?: string;
  /** Table service endpoint for keyless (managed-identity) access in Azure. */
  accountUrl?: string;
  tableName: string;
}

export function readPersistenceConfig(
  env: NodeJS.ProcessEnv,
): PersistenceConfig {
  return {
    connectionString: env.AUDIT_TABLE_CONNECTION_STRING?.trim() || undefined,
    accountUrl: env.AUDIT_TABLE_ACCOUNT_URL?.trim() || undefined,
    tableName: env.AUDIT_TABLE_NAME?.trim() || "AuditEvents",
  };
}

/**
 * Builds a TableClient. Prefers an explicit connection string (local dev);
 * otherwise uses managed identity against the configured table endpoint so the
 * storage account can keep shared-key access disabled. Returns null when
 * neither is configured.
 */
function createClient(config: PersistenceConfig): TableClient | null {
  if (config.connectionString) {
    return TableClient.fromConnectionString(
      config.connectionString,
      config.tableName,
    );
  }
  if (config.accountUrl) {
    return new TableClient(
      config.accountUrl,
      config.tableName,
      new DefaultAzureCredential(),
    );
  }
  return null;
}

// Row/partition keys may not contain '/', '\\', '#', '?' or control chars.
function sanitizeKey(value: string): string {
  return value.replace(/[/\\#?\u0000-\u001f\u007f-\u009f]/g, "_");
}

let tableEnsured = false;

async function ensureTable(client: TableClient): Promise<void> {
  if (tableEnsured) return;
  try {
    await client.createTable();
  } catch (err) {
    // 409 = already exists; any other error is real.
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 409) throw err;
  }
  tableEnsured = true;
}

/**
 * Persists one audit event. Returns false (without throwing) when no storage is
 * configured, so the caller can decide how to degrade.
 */
export async function persistAuditEvent(
  event: AuditEvent,
  config: PersistenceConfig,
): Promise<boolean> {
  const client = createClient(config);
  if (!client) return false;

  await ensureTable(client);

  const entity: TableEntity = {
    partitionKey: sanitizeKey(event.operationType),
    rowKey: sanitizeKey(`${event.timestampUtc}-${event.correlationId}`),
    operationId: event.operationId ?? "",
    operationType: event.operationType,
    actorObjectId: event.actorObjectId ?? "",
    outcome: event.outcome,
    timestampUtc: event.timestampUtc,
    correlationId: event.correlationId,
    targetIdsJson: JSON.stringify(event.targetIds),
    detailsJson: event.details ? JSON.stringify(event.details) : "",
  };

  await client.createEntity(entity);
  return true;
}
