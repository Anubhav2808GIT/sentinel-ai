"use client";

import { useEffect, useRef, useCallback, useState } from "react";

// ─── Connection State ────────────────────────────────────────────────────────
export type WsStatus = "connecting" | "connected" | "disconnected" | "failed";

// ─── Config ──────────────────────────────────────────────────────────────────
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL_MS = 25_000; // send ping every 25s
const HEARTBEAT_TIMEOUT_MS = 10_000; // close if no pong within 10s

export interface WsOptions {
  /** Called once per successfully parsed message. */
  onMessage?: (data: unknown) => void;
  /** Called when connection status changes. */
  onStatusChange?: (status: WsStatus) => void;
}

/**
 * Production-hardened WebSocket hook.
 *
 * Features:
 *  - Exponential back-off reconnect (capped, max attempts)
 *  - Application-level heartbeat / ping-pong
 *  - Duplicate connection prevention
 *  - Stale connection cleanup on unmount
 *  - No reconnect on intentional clean close
 *  - Structured lifecycle logging
 */
export function useWebSocket<T = unknown>(url: string, options: WsOptions = {}) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  // Stable refs — avoid stale closures in callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const attemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const isMountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options; // always up-to-date without re-subscribing

  const updateStatus = useCallback((s: WsStatus) => {
    if (!isMountedRef.current) return;
    setStatus(s);
    optionsRef.current.onStatusChange?.(s);
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimerRef.current = null;
    heartbeatTimeoutRef.current = null;
  }, []);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    clearHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "ping" }));
        // Expect a pong within HEARTBEAT_TIMEOUT_MS
        heartbeatTimeoutRef.current = setTimeout(() => {
          console.warn("[WS] Heartbeat timeout — forcing reconnect");
          ws.close(1000, "heartbeat timeout");
        }, HEARTBEAT_TIMEOUT_MS);
      } catch {
        // ignore — onclose will fire
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeat]);

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;
    
    // Prevent duplicate connections
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // ── Production Guard ──
    // If the frontend is deployed but NEXT_PUBLIC_WS_URL wasn't set, it defaults to localhost.
    // Prevent the hook from entering an infinite reconnect loop trying to hit localhost.
    if (
      typeof window !== "undefined" && 
      url.includes("localhost") && 
      window.location.hostname !== "localhost"
    ) {
      console.error(
        "[WS] 🚨 Refusing to connect to localhost from a production domain. " +
        "You must set NEXT_PUBLIC_WS_URL in your deployment environment variables."
      );
      updateStatus("failed");
      return;
    }

    console.groupCollapsed(`[WS] Connecting → ${url} (attempt ${attemptsRef.current + 1})`);
    console.log("Backoff:", backoffRef.current, "ms | Max attempts:", MAX_RECONNECT_ATTEMPTS);
    console.groupEnd();

    updateStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("[WS] Failed to construct WebSocket:", err);
      updateStatus("failed");
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) { ws.close(); return; }
      console.log(`[WS] ✅ Connected → ${url}`);
      updateStatus("connected");
      attemptsRef.current = 0;
      backoffRef.current = INITIAL_BACKOFF_MS;
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string);
        // Handle server-side pong — clear the pending timeout
        if (parsed?.type === "pong") {
          if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
          }
          return;
        }
        if (!isMountedRef.current) return;
        setData(parsed as T);
        optionsRef.current.onMessage?.(parsed);
      } catch (e) {
        console.warn("[WS] Failed to parse message:", e);
      }
    };

    ws.onerror = (err) => {
      console.error("[WS] Socket error:", err);
    };

    ws.onclose = (event) => {
      clearHeartbeat();
      if (!isMountedRef.current || intentionalCloseRef.current) return;

      const { code, reason, wasClean } = event;
      console.warn(`[WS] Disconnected (code=${code}, clean=${wasClean}, reason="${reason || 'none'}")`);
      updateStatus("disconnected");

      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error("[WS] Max reconnect attempts reached — giving up");
        updateStatus("failed");
        return;
      }

      // Exponential back-off
      const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      console.log(`[WS] Reconnecting in ${delay}ms…`);
      reconnectTimerRef.current = setTimeout(() => {
        attemptsRef.current++;
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        connect();
      }, delay);
    };
  }, [url, updateStatus, startHeartbeat, clearHeartbeat]);

  useEffect(() => {
    isMountedRef.current = true;
    intentionalCloseRef.current = false;
    connect();

    return () => {
      isMountedRef.current = false;
      intentionalCloseRef.current = true;

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearHeartbeat();

      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "component unmounted");
        }
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { data, status, isConnected: status === "connected" };
}
