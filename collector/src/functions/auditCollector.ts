// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Audit collector: HTTP entrypoint. Accepts a POSTed admin AuditEvent from the
// Fabric Capacity Manager client, authenticates the caller against Entra ID,
// validates the payload, stamps the verified actor identity, records it to
// Application Insights (structured log) and persists it to Table Storage.
//
// Auth model: the function is `anonymous` at the platform level so the SPA can
// call it with an Entra bearer token; identity is enforced in `authorize`.

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { parseAuditEvent } from "../auditEvent";
import { authorize, readAuthConfig } from "../auth";
import { persistAuditEvent, readPersistenceConfig } from "../tableStore";

export async function auditCollector(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await authorize(
    request.headers.get("authorization"),
    readAuthConfig(process.env),
  );
  if (!auth.ok) {
    return { status: auth.status, jsonBody: { error: auth.error } };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "Body must be valid JSON." } };
  }

  const parsed = parseAuditEvent(body);
  if (!parsed) {
    return {
      status: 400,
      jsonBody: { error: "Body is not a well-formed AuditEvent." },
    };
  }

  // Trust the server-verified identity over any client-supplied actor.
  const event = {
    ...parsed,
    actorObjectId: auth.actorObjectId ?? parsed.actorObjectId,
  };

  // Structured log -> captured as an Application Insights trace/customEvent.
  context.log("admin.audit", {
    operationType: event.operationType,
    outcome: event.outcome,
    actorObjectId: event.actorObjectId,
    correlationId: event.correlationId,
    operationId: event.operationId,
  });

  try {
    const persisted = await persistAuditEvent(event, readPersistenceConfig(process.env));
    if (!persisted) {
      context.warn(
        "AUDIT_TABLE_CONNECTION_STRING not set; event logged but not persisted to Table Storage.",
      );
    }
  } catch (err) {
    context.error("Failed to persist audit event", err);
    return {
      status: 502,
      jsonBody: { error: "Failed to persist audit event." },
    };
  }

  return { status: 202, jsonBody: { accepted: true } };
}

app.http("auditCollector", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "audit",
  handler: auditCollector,
});
