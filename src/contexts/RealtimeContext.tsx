"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_ENDPOINTS } from '@/constants';

type RTData = any;

interface RealtimeContextType {
  data: RTData | null;
  error: string | null;
  loading: boolean;
  lastUpdated: Date | null;
  refetch: () => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

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

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (context === undefined) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}
