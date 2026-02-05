import { useState, useCallback, useEffect } from 'react';

/** A persisted record of a successful send */
export interface RecentSend {
  /** Unique key for React rendering */
  id: string;
  /** Amount sent */
  amount: number;
  /** Token symbol (SOL, WSOL) */
  token: string;
  /** Full namespaced recipient (e.g., twitter:@user) */
  recipient: string;
  /** Solana transaction signature */
  signature: string;
  /** Claim link URL */
  shareLink: string;
  /** ISO timestamp */
  timestamp: string;
}

const STORAGE_KEY = 'murkl:recent-sends';
const MAX_RECENT = 5;

/**
 * Read recent sends from localStorage.
 * Returns empty array on parse failure — never throws.
 */
function readSends(): RecentSend[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Write recent sends to localStorage (capped at MAX_RECENT).
 */
function writeSends(sends: RecentSend[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sends.slice(0, MAX_RECENT)));
  } catch {
    // Quota exceeded or private browsing — silently fail
  }
}

/**
 * Hook to manage recent sends stored in localStorage.
 *
 * - Persists across sessions
 * - Capped at 5 most recent entries
 * - Syncs with other tabs via `storage` event
 * - Never blocks UI — read/write errors are swallowed
 */
export function useRecentSends() {
  const [sends, setSends] = useState<RecentSend[]>(readSends);

  // Sync with other tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setSends(readSends());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  /** Add a new send to the top of the list */
  const addSend = useCallback((send: Omit<RecentSend, 'id' | 'timestamp'>) => {
    const entry: RecentSend = {
      ...send,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    setSends((prev) => {
      const next = [entry, ...prev].slice(0, MAX_RECENT);
      writeSends(next);
      return next;
    });
  }, []);

  /** Clear all recent sends */
  const clearSends = useCallback(() => {
    setSends([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
  }, []);

  return { sends, addSend, clearSends } as const;
}
