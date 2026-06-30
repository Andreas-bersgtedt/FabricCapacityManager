// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Audit collector: Entra ID (Azure AD) bearer-token validation.
//
// The Fabric Capacity Manager SPA attaches an access token (acquired for the
// scope in VITE_AUDIT_REMOTE_SCOPE) when posting audit events. This module
// verifies that token's signature against the tenant JWKS and checks the
// issuer, audience and expiry, so the collector only accepts events from the
// trusted client. The verified `oid`/`sub` is treated as the authoritative
// actor identity (never trust the client-supplied actorObjectId for identity).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthConfig {
  tenantId?: string;
  audience?: string;
  /** Dev-only escape hatch; must be explicitly enabled. */
  allowAnonymous: boolean;
}

export interface AuthResult {
  ok: boolean;
  /** Verified actor object id (oid) or subject, when authenticated. */
  actorObjectId?: string;
  status: number;
  error?: string;
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  return {
    tenantId: env.AUDIT_TENANT_ID?.trim() || undefined,
    audience: env.AUDIT_AUDIENCE?.trim() || undefined,
    allowAnonymous: env.AUDIT_ALLOW_ANONYMOUS === "true",
  };
}

// One JWKS resolver per tenant, cached across invocations on a warm instance.
const jwksCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function getJwks(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      ),
    );
    jwksCache.set(tenantId, jwks);
  }
  return jwks;
}

function extractBearer(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1]! : null;
}

/**
 * Validates the request's Authorization header. Returns the verified actor on
 * success, or an HTTP status + reason on failure.
 */
export async function authorize(
  authorizationHeader: string | null,
  config: AuthConfig,
): Promise<AuthResult> {
  if (config.allowAnonymous) {
    return { ok: true, status: 200 };
  }

  // Secure by default: refuse to run "open" unless explicitly configured.
  if (!config.tenantId || !config.audience) {
    return {
      ok: false,
      status: 500,
      error:
        "Collector auth not configured. Set AUDIT_TENANT_ID and AUDIT_AUDIENCE, " +
        "or AUDIT_ALLOW_ANONYMOUS=true for local development only.",
    };
  }

  const token = extractBearer(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }

  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(
      token,
      getJwks(config.tenantId),
      {
        issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
        audience: config.audience,
      },
    );
    const actorObjectId =
      (typeof payload.oid === "string" && payload.oid) ||
      (typeof payload.sub === "string" && payload.sub) ||
      undefined;
    return { ok: true, status: 200, actorObjectId };
  } catch {
    // Do not leak token-validation specifics to the caller.
    return { ok: false, status: 401, error: "Invalid or expired token." };
  }
}
