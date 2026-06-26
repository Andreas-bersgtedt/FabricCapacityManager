// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: context that gates admin (write) actions behind an
// explicit, role-aware toggle. Write UI must check both `canManage` (permission)
// and `isAdminMode` (the user opted in) before exposing destructive actions.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface AdminModeValue {
  /** True only when the user is permitted AND has enabled admin mode. */
  isAdminMode: boolean;
  /** Whether the signed-in user is permitted to use admin actions at all. */
  canManage: boolean;
  toggleAdminMode(): void;
  setAdminMode(on: boolean): void;
}

const AdminModeContext = createContext<AdminModeValue | null>(null);

interface AdminModeProviderProps {
  children: ReactNode;
  /**
   * Permission gate deciding whether admin actions are available to this user.
   * Derived from workspace role assignments (Admin of at least one workspace).
   */
  canManage?: boolean;
}

export function AdminModeProvider({
  children,
  canManage = false,
}: AdminModeProviderProps) {
  const [enabled, setEnabled] = useState(false);

  const setAdminMode = useCallback(
    (on: boolean) => setEnabled(on && canManage),
    [canManage],
  );
  const toggleAdminMode = useCallback(
    () => setEnabled((v) => !v && canManage),
    [canManage],
  );

  const value = useMemo<AdminModeValue>(
    () => ({
      isAdminMode: enabled && canManage,
      canManage,
      toggleAdminMode,
      setAdminMode,
    }),
    [enabled, canManage, toggleAdminMode, setAdminMode],
  );

  return (
    <AdminModeContext.Provider value={value}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode(): AdminModeValue {
  const ctx = useContext(AdminModeContext);
  if (!ctx) {
    throw new Error("useAdminMode must be used within an AdminModeProvider.");
  }
  return ctx;
}
