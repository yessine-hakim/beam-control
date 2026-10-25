import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { WireSnapshot } from './types';

/** Latest server snapshot: first paint from /api/state, then live over socket.io. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<WireSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/state')
      .then((r) => (r.ok ? (r.json() as Promise<WireSnapshot>) : null))
      .then((s) => {
        if (!cancelled && s) setSnapshot((current) => current ?? s);
      })
      .catch(() => {});
    const socket = io();
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('snapshot', (s: WireSnapshot) => setSnapshot(s));
    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((event: 'drill' | 'liveFeed', payload?: unknown) => {
    return new Promise<unknown>((resolve) => {
      const socket = socketRef.current;
      if (!socket?.connected) return resolve(null);
      socket.timeout(5000).emit(event, payload ?? null, (_err: unknown, ack: unknown) => resolve(ack ?? null));
    });
  }, []);

  return { snapshot, connected, send };
}
