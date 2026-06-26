// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// MSAL-backed token provider. Acquires tokens silently from the cache when
// possible, falling back to an interactive popup when the user must consent or
// re-authenticate (e.g. a different resource/scope).

import { useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import type { TokenProvider } from "../api/fabricApi";

export function createTokenProvider(
  instance: IPublicClientApplication,
  account: AccountInfo,
): TokenProvider {
  return async (scopes: string[]) => {
    try {
      const result = await instance.acquireTokenSilent({ scopes, account });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await instance.acquireTokenPopup({ scopes, account });
        return result.accessToken;
      }
      throw err;
    }
  };
}

/** Returns a {@link TokenProvider} for the signed-in account, or null if none. */
export function useTokenProvider(): TokenProvider | null {
  const { instance, accounts } = useMsal();
  const account = accounts[0] ?? null;
  return useMemo(
    () => (account ? createTokenProvider(instance, account) : null),
    [instance, account],
  );
}
