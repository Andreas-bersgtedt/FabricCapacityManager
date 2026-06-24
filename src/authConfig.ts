// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// MSAL authentication configuration and the delegated API scopes used to call
// the Microsoft Fabric and Power BI REST APIs.

import {
  type Configuration,
  LogLevel,
} from "@azure/msal-browser";

const clientId = import.meta.env.VITE_AAD_CLIENT_ID;
const tenantId = import.meta.env.VITE_AAD_TENANT_ID || "organizations";

/**
 * MSAL configuration for a browser-based SPA (public client).
 * Tokens are acquired via an interactive OAuth web dialog (popup).
 */
export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    // The redirect URI must be registered as a "Single-page application"
    // platform redirect URI in the Entra app registration.
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error(message);
      },
    },
  },
};

/**
 * Delegated scopes for the Microsoft Fabric REST API
 * (workspaces, items and capacities).
 */
export const fabricScopes = [
  "https://api.fabric.microsoft.com/Workspace.Read.All",
  "https://api.fabric.microsoft.com/Item.Read.All",
  "https://api.fabric.microsoft.com/Capacity.Read.All",
];

/**
 * Delegated scopes for the Power BI REST API. Used to read semantic-model
 * storage mode (targetStorageMode) which is not exposed by the Fabric API.
 */
export const powerBiScopes = [
  "https://analysis.windows.net/powerbi/api/Dataset.Read.All",
  "https://analysis.windows.net/powerbi/api/Workspace.Read.All",
];

/**
 * Scopes requested during the initial interactive sign-in.
 *
 * MSAL only allows scopes for a SINGLE resource per request, so we cannot mix
 * Fabric and Power BI scopes here (doing so makes loginPopup reject and the UI
 * never updates). We consent to the Fabric scopes at sign-in; the Power BI
 * token is acquired separately on demand during data loading.
 */
export const loginRequest = {
  scopes: fabricScopes,
  prompt: "select_account",
};

export const isAuthConfigured = Boolean(
  clientId && clientId !== "00000000-0000-0000-0000-000000000000",
);
