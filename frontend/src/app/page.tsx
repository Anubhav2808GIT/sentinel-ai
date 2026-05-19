"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWebSocket, type WsStatus } from "@/hooks/useWebSocket";
import { Activity, AlertTriangle, CheckCircle, ShieldAlert, Wifi, WifiOff, Loader2 } from "lucide-react";
import { IncidentFeed, type IncidentType } from "@/components/IncidentFeed";
import { IncidentDetailModal } from "@/components/IncidentDetailModal";
import { ThroughputChart } from "@/components/ThroughputChart";
import { ToastNotifications, type Toast } from "@/components/ToastNotifications";
import { LiveActivityTicker, type TickerEvent } from "@/components/LiveActivityTicker";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { motion } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_INCIDENTS = 50;          // bounded incident list
const MAX_TICKER_EVENTS = 30;      // bounded ticker
const MAX_CHART_POINTS = 40;       // bounded chart
const MAX_TOASTS = 5;
const MAX_DEMO_INCIDENTS = 20;     // cap demo active incidents
const DEMO_INTERVAL_MS = 4_000;    // minimum 4s between demo events
const WS_DEBOUNCE_MS = 80;         // batch rapid WS messages

// ─── Demo scenario config ─────────────────────────────────────────────────────
const DEMO_CONFIGS = {
  "db-saturation":     { service: "database-cluster",  initialEvents: 50 },
  "redis-collapse":    { service: "redis-cache",        initialEvents: 80 },
  "auth-storm":        { service: "auth-service",       initialEvents: 60 },
  "gateway-cascading": { service: "gateway-api",        initialEvents: 40 },
} as const;

type DemoScenario = keyof typeof DEMO_CONFIGS;

export default function Dashboard() {
  const rawWsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8003/ws";
  const wsUrl = typeof window !== "undefined" && rawWsUrl.includes("localhost") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? rawWsUrl.replace("localhost", window.location.hostname)
    : rawWsUrl;

  const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";
  const apiUrl = typeof window !== "undefined" && rawApiUrl.includes("localhost") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? rawApiUrl.replace("localhost", window.location.hostname)
    : rawApiUrl;

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  const { data: wsData, status: wsStatus, isConnected } = useWebSocket(wsUrl);

  // ─── Core state ─────────────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState({
    activeIncidents: 0,
    totalEvents: 0,
    analysesCompleted: 0,
    mttr: "12m",
    criticalRatio: "0%",
  });
  const [incidents, setIncidents] = useState<IncidentType[]>([]);
  const [chartRaw, setChartRaw] = useState<{ time: string; events: number; critical?: number }[]>([]);
  const [tickerEvents, setTickerEvents] = useState<TickerEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<DemoScenario | null>(null);
  const [reconnectBanner, setReconnectBanner] = useState(false);

  // ─── Document Title Guard ──────────────────────────────────────────────────
  useEffect(() => {
    document.title = "SentinelAI — Real-Time Incident Intelligence";
  }, []);

  // ─── Reconnect banner ────────────────────────────────────────────────────────
  const prevWsStatus = useRef<WsStatus>("connecting");
  useEffect(() => {
    if (prevWsStatus.current === "disconnected" && wsStatus === "connected") {
      setReconnectBanner(true);
      const t = setTimeout(() => setReconnectBanner(false), 4000);
      return () => clearTimeout(t);
    }
    prevWsStatus.current = wsStatus;
  }, [wsStatus]);

  // ─── Stable helper: add ticker event ────────────────────────────────────────
  const pushTicker = useCallback((evt: Omit<TickerEvent, "id">) => {
    setTickerEvents((prev) =>
      [...prev, { ...evt, id: `tick-${Date.now()}-${Math.random()}` }].slice(-MAX_TICKER_EVENTS)
    );
  }, []);

  // ─── Stable helper: push chart point ────────────────────────────────────────
  const pushChartPoint = useCallback((time: string, events: number, critical: number) => {
    setChartRaw((prev) =>
      [...prev, { time, events, critical }].slice(-MAX_CHART_POINTS)
    );
  }, []);

  // ─── Toast dismiss ───────────────────────────────────────────────────────────
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Initial data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [statsRes, incRes] = await Promise.all([
          fetch(`${apiUrl}/stats`),
          fetch(`${apiUrl}/incidents`),
        ]);
        if (statsRes.ok) {
          const s = await statsRes.json();
          setMetrics((prev) => ({
            ...prev,
            activeIncidents: s.activeIncidents,
            totalEvents: s.totalEvents,
            analysesCompleted: s.analysesCompleted,
          }));
        }
        if (incRes.ok) {
          const d = await incRes.json();
          setIncidents((d.incidents ?? []).slice(0, MAX_INCIDENTS));
        }
      } catch (err) {
        console.error("[Dashboard] Failed to fetch initial data:", err);
      }
    };
    fetchInitialData();
  }, [apiUrl, demoMode]); // Re-fetch when switching back to Live Mode

  // ─── WS event handler (debounced batch) ─────────────────────────────────────
  // Queue messages and flush in a rAF to batch React updates
  const wsQueueRef = useRef<unknown[]>([]);
  const wsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushWsQueue = useCallback(() => {
    wsFlushTimerRef.current = null;
    const messages = wsQueueRef.current.splice(0);
    if (!messages.length) return;

    // Process all queued messages in a single render pass
    let deltaActive = 0;
    let deltaEvents = 0;
    let deltaAnalyses = 0;
    const newIncidents: IncidentType[] = [];
    const updatedIncidents = new Map<string, Partial<IncidentType>>();
    const newTickers: Omit<TickerEvent, "id">[] = [];
    const newChartPoints: { time: string; events: number; critical: number }[] = [];
    const newToasts: Toast[] = [];

    const now = new Date().toLocaleTimeString();

    for (const msg of messages) {
      const wsData = msg as Record<string, unknown>;
      if (!wsData?.type) continue;

      if (wsData.type === "incident_created" || wsData.type === "incident_updated") {
        const isCritical = wsData.severity === "high" || wsData.severity === "critical";
        deltaEvents++;

        if (wsData.type === "incident_created") {
          deltaActive++;
          newIncidents.push({
            id: wsData.incident_id as string,
            service: wsData.service as string,
            severity: wsData.severity as IncidentType["severity"],
            status: "active",
            event_count: 1,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
          });
          newTickers.push({
            message: `${wsData.service} incident created`,
            timestamp: new Date(),
            level: isCritical ? "critical" : "warning",
          });
          if (isCritical) {
            newToasts.push({
              id: `${wsData.incident_id}-${Date.now()}`,
              incidentId: wsData.incident_id as string,
              service: wsData.service as string,
              severity: wsData.severity as string,
              timestamp: new Date(),
            });
          }
        } else {
          // incident_updated
          updatedIncidents.set(wsData.incident_id as string, {
            event_count: wsData.event_count as number,
            last_seen: new Date().toISOString(),
          });
          
          // Stream normal logs to the ticker
          if (wsData.latest_message) {
            const lvlStr = (wsData.latest_level as string)?.toLowerCase() || "info";
            const levelMap: Record<string, TickerEvent["level"]> = {
              "error": "error", "critical": "critical", "fatal": "critical",
              "warn": "warning", "warning": "warning"
            };
            newTickers.push({
              message: `[${wsData.service}] ${wsData.latest_message}`,
              timestamp: new Date(),
              level: levelMap[lvlStr] || "info",
            });
          }

          if (wsData.status === "resolved") {
            newTickers.push({
              message: `Incident in ${wsData.service} resolved`,
              timestamp: new Date(),
              level: "info",
            });
          }
        }
        newChartPoints.push({ time: now, events: 1, critical: isCritical ? 1 : 0 });
      }

      if (wsData.type === "analysis_completed") {
        deltaAnalyses++;
        newTickers.push({
          message: `AI RCA completed for INC-${(wsData.incident_id as string).split("-")[0].toUpperCase()}`,
          timestamp: new Date(),
          level: "info",
        });
      }
    }

    // Flush all state in a single batched React update
    if (deltaActive || deltaEvents || deltaAnalyses) {
      setMetrics((prev) => ({
        ...prev,
        totalEvents: prev.totalEvents + deltaEvents,
        activeIncidents: Math.max(0, prev.activeIncidents + deltaActive),
        analysesCompleted: prev.analysesCompleted + deltaAnalyses,
      }));
    }
    if (newIncidents.length) {
      setIncidents((prev) => [...newIncidents, ...prev].slice(0, MAX_INCIDENTS));
    }
    if (updatedIncidents.size) {
      setIncidents((prev) =>
        prev
          .map((inc) => {
            const patch = updatedIncidents.get(inc.id);
            return patch ? { ...inc, ...patch } : inc;
          })
          .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
      );
    }
    if (newChartPoints.length) {
      setChartRaw((prev) => [...prev, ...newChartPoints].slice(-MAX_CHART_POINTS));
    }
    if (newTickers.length) {
      setTickerEvents((prev) =>
        [
          ...prev,
          ...newTickers.map((t) => ({ ...t, id: `tick-${Date.now()}-${Math.random()}` })),
        ].slice(-MAX_TICKER_EVENTS)
      );
    }
    if (newToasts.length) {
      setToasts((prev) => [...newToasts, ...prev].slice(0, MAX_TOASTS));
    }
  }, []);

  useEffect(() => {
    if (!wsData) return;
    wsQueueRef.current.push(wsData);
    if (!wsFlushTimerRef.current) {
      wsFlushTimerRef.current = setTimeout(flushWsQueue, WS_DEBOUNCE_MS);
    }
  }, [wsData, flushWsQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsFlushTimerRef.current) clearTimeout(wsFlushTimerRef.current);
    };
  }, []);

  // ─── Demo Mode (throttled, bounded) ─────────────────────────────────────────
  useEffect(() => {
    if (!demoMode) return;

    let isMounted = true;
    let step = 0;
    const config = DEMO_CONFIGS[demoMode];

    const runScenario = () => {
      if (!isMounted) return;
      const now = new Date();
      const nowStr = now.toLocaleTimeString();

      // Safety: cap active demo incidents
      setIncidents((prev) => {
        const activeDemo = prev.filter((i) => i.id.startsWith("DEMO-")).length;
        if (activeDemo >= MAX_DEMO_INCIDENTS) return prev;

        // Randomize severity to make demo realistic (weighted towards high/critical)
        const severities: IncidentType["severity"][] = ["low", "medium", "high", "critical", "critical"];
        const randomSeverity = severities[Math.floor(Math.random() * severities.length)];

        const id = `DEMO-${demoMode.substring(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const newInc: IncidentType = {
          id,
          service: config.service,
          severity: randomSeverity,
          status: "active",
          event_count: config.initialEvents + step * 10,
          first_seen: now.toISOString(),
          last_seen: now.toISOString(),
        };
        return [newInc, ...prev].slice(0, MAX_INCIDENTS);
      });

      setMetrics((prev) => ({
        ...prev,
        totalEvents: prev.totalEvents + config.initialEvents,
        activeIncidents: Math.min(prev.activeIncidents + 1, 99),
        criticalRatio: "92%",
        mttr: "1hr 15m",
      }));

      pushChartPoint(nowStr, Math.min(config.initialEvents / 10 + step * 2, 100), 1);

      pushTicker({
        message: `[DEMO: ${demoMode.toUpperCase()}] Detected in ${config.service.toUpperCase()}`,
        timestamp: now,
        level: "warning",
      });

      setToasts((prev) => {
        const id = `DEMO-${Date.now()}`;
        return [
          { id, incidentId: id, service: config.service, severity: "high", timestamp: now },
          ...prev,
        ].slice(0, MAX_TOASTS);
      });

      // Delayed AI RCA simulation
      const rcaTimer = setTimeout(() => {
        if (!isMounted) return;
        pushTicker({
          message: `[DEMO: AI RCA] Cascading impact from ${config.service}`,
          timestamp: new Date(),
          level: "warning",
        });
        setMetrics((prev) => ({ ...prev, analysesCompleted: prev.analysesCompleted + 1 }));
      }, 1800);

      step++;
      return rcaTimer;
    };

    // Initial burst
    const firstRca = runScenario();
    const interval = setInterval(runScenario, DEMO_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearTimeout(firstRca);
      clearInterval(interval);
      // Clean up DEMO incidents when leaving Demo Mode
      setIncidents((prev) => prev.filter((i) => !i.id.startsWith("DEMO-")));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, pushTicker, pushChartPoint]);

  // ─── Derived service health (memoized) ──────────────────────────────────────
  const serviceHealth = useMemo(() => ({
    auth: demoMode === "auth-storm" ? "critical" : "healthy",
    db: demoMode === "db-saturation" ? "critical" : "healthy",
    redis: demoMode === "redis-collapse" ? "critical" : "healthy",
    gateway: demoMode === "gateway-cascading" ? "critical" : "healthy",
  }), [demoMode]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-command-center flex flex-col relative overflow-hidden">
      {/* Deployment banner — only visible in public cloud demo */}
      <DeploymentBanner />

      {/* Ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-96 bg-blue-500/5 blur-[120px] pointer-events-none" />

      {/* Reconnect banner */}
      {reconnectBanner && (
        <div className="fixed top-0 inset-x-0 z-[200] flex items-center justify-center gap-2 bg-green-500/10 border-b border-green-500/20 py-1.5 text-xs text-green-400 font-medium">
          <Wifi className="w-3 h-3" /> WebSocket reconnected
        </div>
      )}

      <ErrorBoundary label="LiveActivityTicker">
        <LiveActivityTicker events={tickerEvents} />
      </ErrorBoundary>

      <div className="p-6 max-w-7xl mx-auto space-y-6 flex-1 w-full">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">SentinelAI</h1>
            <p className="text-sm text-muted-foreground">Real-time AI infrastructure observability</p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/architecture"
              className="text-xs font-mono text-muted-foreground hover:text-blue-400 transition-colors underline decoration-blue-500/30 underline-offset-4"
            >
              [View Architecture Map]
            </a>

            <div className="flex items-center gap-2 border border-border rounded-lg bg-muted/20 p-1">
              <select
                className="bg-transparent text-xs font-bold text-muted-foreground outline-none cursor-pointer"
                onChange={(e) =>
                  setDemoMode(e.target.value === "off" ? null : (e.target.value as DemoScenario))
                }
                value={demoMode || "off"}
              >
                <option value="off">Live Mode</option>
                <option value="db-saturation">Demo: DB Saturation</option>
                <option value="redis-collapse">Demo: Redis Collapse</option>
                <option value="auth-storm">Demo: Auth Storm</option>
                <option value="gateway-cascading">Demo: Gateway Cascading</option>
              </select>
            </div>

            <WsStatusBadge status={wsStatus} />
          </div>
        </div>

        {/* ── Real-Time Service Health Grid ─────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <HealthNode name="Gateway API" latency="12ms" status={serviceHealth.gateway as "healthy" | "warning" | "critical"} />
          <HealthNode name="Auth Service" latency="45ms" status={serviceHealth.auth as "healthy" | "warning" | "critical"} />
          <HealthNode name="PostgreSQL" latency="8ms" status={serviceHealth.db as "healthy" | "warning" | "critical"} />
          <HealthNode name="Redis Cache" latency="2ms" status={serviceHealth.redis as "healthy" | "warning" | "critical"} />
          <HealthNode name="AI Engine" latency="1.2s" status="healthy" />
          <HealthNode name="Workers" latency="--" status="healthy" />
        </div>

        {/* ── Metric Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard title="Active Incidents" value={metrics.activeIncidents} icon={<AlertTriangle className="text-amber-500 w-5 h-5" />} accent="amber" />
          <MetricCard title="MTTR" value={metrics.mttr} icon={<Activity className="text-blue-500 w-5 h-5" />} accent="blue" trend="-2m" />
          <MetricCard title="Critical Ratio" value={metrics.criticalRatio} icon={<ShieldAlert className="text-red-500 w-5 h-5" />} accent="red" trend="+5%" />
          <MetricCard title="Analyses Done" value={metrics.analysesCompleted} icon={<CheckCircle className="text-purple-500 w-5 h-5" />} accent="purple" />
          <MetricCard title="System Health" value="100%" icon={<ShieldAlert className="text-green-500 w-5 h-5" />} accent="green" />
        </div>

        {/* ── Main Grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ErrorBoundary label="ThroughputChart">
              <ThroughputChart externalData={chartRaw} />
            </ErrorBoundary>
          </div>
          <div className="lg:col-span-1 min-h-[460px]">
            <ErrorBoundary label="IncidentFeed">
              <IncidentFeed incidents={incidents} onSelectIncident={setSelectedIncidentId} />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      {/* ── Modals & Overlays ───────────────────────────────────── */}
      <ErrorBoundary label="IncidentDetailModal">
        <IncidentDetailModal incidentId={selectedIncidentId} onClose={() => setSelectedIncidentId(null)} />
      </ErrorBoundary>

      <ToastNotifications
        toasts={toasts}
        onDismiss={dismissToast}
        onOpen={(id) => {
          setSelectedIncidentId(id);
          dismissToast(id);
        }}
      />
    </div>
  );
}

// ─── WS Status Badge ─────────────────────────────────────────────────────────
function WsStatusBadge({ status }: { status: WsStatus }) {
  const config = {
    connected:     { className: "bg-green-500/10 text-green-400 border-green-500/30", dot: "bg-green-500 animate-pulse", label: "LIVE STREAM" },
    connecting:    { className: "bg-blue-500/10 text-blue-400 border-blue-500/30",    dot: "bg-blue-500 animate-pulse", label: "CONNECTING" },
    disconnected:  { className: "bg-amber-500/10 text-amber-400 border-amber-500/30", dot: "bg-amber-500",              label: "RECONNECTING" },
    failed:        { className: "bg-red-500/10 text-red-400 border-red-500/30",       dot: "bg-red-500",               label: "OFFLINE" },
  }[status];

  return (
    <div className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border transition-colors ${config.className}`}>
      {status === "connecting" || status === "disconnected"
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : status === "connected"
        ? <span className={`w-2 h-2 rounded-full ${config.dot}`} />
        : <WifiOff className="w-3 h-3" />
      }
      {config.label}
    </div>
  );
}

// ─── MetricCard ──────────────────────────────────────────────────────────────
const ACCENT_GLOW: Record<string, string> = {
  amber:  "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.1)] border-amber-500/10",
  blue:   "group-hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] border-blue-500/10",
  purple: "group-hover:shadow-[0_0_20px_rgba(168,85,247,0.1)] border-purple-500/10",
  green:  "group-hover:shadow-[0_0_20px_rgba(34,197,94,0.1)] border-green-500/10",
  red:    "group-hover:shadow-[0_0_20px_rgba(239,68,68,0.1)] border-red-500/10",
};

function MetricCard({
  title, value, icon, accent = "blue", trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
  trend?: string;
}) {
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`p-5 rounded-xl border bg-card relative overflow-hidden group transition-all duration-300 ${ACCENT_GLOW[accent] ?? "border-border"}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br from-${accent}-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
      <div className="flex items-center justify-between mb-3 relative">
        <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{title}</h3>
        {icon}
      </div>
      <div className="flex items-end gap-3 relative">
        <motion.p
          key={value}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="text-3xl font-mono font-bold text-foreground"
        >
          {value}
        </motion.p>
        {trend && (
          <span className={`text-xs font-medium mb-1 ${trend.startsWith("+") ? "text-red-400" : "text-green-400"}`}>
            {trend}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─── HealthNode ───────────────────────────────────────────────────────────────
function HealthNode({ name, latency, status }: { name: string; latency: string; status: "healthy" | "warning" | "critical" }) {
  const isCritical = status === "critical";
  const color = isCritical ? "bg-red-500" : status === "warning" ? "bg-amber-500" : "bg-green-500";
  const glow = isCritical ? "shadow-[0_0_15px_rgba(239,68,68,0.5)] border-red-500/50 bg-red-500/10" : "border-border bg-card/50";
  return (
    <div className={`flex items-center justify-between p-2 rounded-lg border ${glow} transition-all duration-500`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${color} ${isCritical ? "animate-ping" : ""}`} />
        <span className="text-[10px] font-mono text-muted-foreground uppercase truncate w-16">{name}</span>
      </div>
      <span className={`text-[10px] font-mono ${isCritical ? "text-red-400 font-bold" : "text-foreground"}`}>{latency}</span>
    </div>
  );
}
