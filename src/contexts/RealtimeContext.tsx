"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_ENDPOINTS } from '@/constants';

type RTData = any;

/**
 * Defines the shape of the RealtimeContext.
 */
interface RealtimeContextType {
  /** The most recent real-time data object. */
  data: RTData | null;
  /** Any error message from the last fetch attempt. */
  error: string | null;
  /** True if data is currently being fetched. */
  loading: boolean;
  /** The timestamp of the last successful data update. */
  lastUpdated: Date | null;
  /** A function to manually trigger a data refetch. */
  refetch: () => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

/**
 * A React context provider that fetches and manages real-time weather data.
 * It periodically refetches the data and makes it available to all child components.
 * @param props - The component props.
 * @param props.children - The child components that will consume the context.
 * @returns A RealtimeContext.Provider component.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<RTData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    console.log('[RealtimeContext] fetchData called');
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(API_ENDPOINTS.RT_LAST, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rec = await res.json();
      if (!rec || rec.ok === false) {
        const msg = rec?.error || 'No data available';
        setError(msg);
        return;
      }
      setData(rec.data ?? null);
      setLastUpdated(rec.updatedAt ? new Date(rec.updatedAt) : new Date());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[RealtimeContext] useEffect running, setting up interval');
    fetchData();
    const refreshMs = Number(process.env.NEXT_PUBLIC_RT_REFRESH_MS || 300000); // default 5 min
    const id = setInterval(() => {
      console.log('[RealtimeContext] Interval tick');
      fetchData();
    }, isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 300000);
    return () => {
      console.log('[RealtimeContext] Cleaning up interval');
      clearInterval(id);
    };
  }, []); // Remove fetchData from dependencies to prevent infinite loop

  return (
    <RealtimeContext.Provider value={{
      data,
      error,
      loading,
      lastUpdated,
      refetch: fetchData
    }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * A custom hook to access the real-time weather data context.
 * Throws an error if used outside of a `RealtimeProvider`.
 * @returns The real-time context, including data, loading state, errors, and a refetch function.
 */
export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (context === undefined) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}
