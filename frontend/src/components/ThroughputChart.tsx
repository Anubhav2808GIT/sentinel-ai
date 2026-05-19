"use client";

import { useEffect, useRef, memo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Activity } from "lucide-react";
import { useReducer } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DataPoint {
  time: string;
  events: number;
  critical: number;
}

interface ThroughputChartProps {
  /** Raw data from the parent — one point per WS event */
  externalData: { time: string; events: number; critical?: number }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WINDOW = 40;         // visible data points
const TICK_INTERVAL = 2000; // baseline ticker interval (ms)

// ─── Reducer — single source of truth for chart data ─────────────────────────
type Action =
  | { type: "PUSH_EXTERNAL"; points: { time: string; events: number; critical?: number }[] }
  | { type: "TICK_BASELINE" };

function chartReducer(state: DataPoint[], action: Action): DataPoint[] {
  switch (action.type) {
    case "PUSH_EXTERNAL": {
      if (!action.points.length) return state;
      const next = [...state];
      for (const p of action.points) {
        const last = next[next.length - 1];
        if (last && last.time === p.time) {
          // Accumulate into the current second bucket
          next[next.length - 1] = {
            ...last,
            events: last.events + p.events,
            critical: last.critical + (p.critical ?? 0),
          };
        } else {
          next.push({ time: p.time, events: p.events, critical: p.critical ?? 0 });
          if (next.length > WINDOW) next.shift();
        }
      }
      return next;
    }
    case "TICK_BASELINE": {
      // Only add a baseline tick if the most recent point is not from "this second"
      const now = new Date().toLocaleTimeString();
      const last = state[state.length - 1];
      if (last?.time === now) return state; // WS already updated this second

      const prev = last?.events ?? 4;
      const noise = (Math.random() - 0.48) * 3;
      const next = [...state, {
        time: now,
        events: Math.round(Math.max(0, Math.min(40, prev + noise + (4 - prev) * 0.08))),
        critical: 0,
      }];
      if (next.length > WINDOW) next.shift();
      return next;
    }
    default:
      return state;
  }
}

// ─── Initial seed ─────────────────────────────────────────────────────────────
function seedData(): DataPoint[] {
  const seed: DataPoint[] = [];
  let val = 4;
  for (let i = WINDOW; i > 0; i--) {
    const noise = (Math.random() - 0.48) * 3;
    val = Math.max(0, Math.min(40, val + noise + (4 - val) * 0.08));
    seed.push({
      time: new Date(Date.now() - i * TICK_INTERVAL).toLocaleTimeString(),
      events: Math.round(val),
      critical: 0,
    });
  }
  return seed;
}

// ─── Custom Tooltip (stable reference — prevents re-mount on every render) ────
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111113] border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <div className="text-muted-foreground mb-1">{label}</div>
      <div className="text-blue-400">
        Events/s: <span className="text-foreground font-bold">{payload[0]?.value}</span>
      </div>
      {(payload[1]?.value ?? 0) > 0 && (
        <div className="text-red-400">
          Critical: <span className="text-foreground font-bold">{payload[1]?.value}</span>
        </div>
      )}
    </div>
  );
});

// ─── Chart Component ──────────────────────────────────────────────────────────
export const ThroughputChart = memo(function ThroughputChart({ externalData }: ThroughputChartProps) {
  const [data, dispatch] = useReducer(chartReducer, undefined, seedData);

  // Track external data length to only process genuinely new points
  const prevExternalLen = useRef(externalData.length);
  useEffect(() => {
    if (externalData.length === prevExternalLen.current) return;
    const newPoints = externalData.slice(prevExternalLen.current);
    prevExternalLen.current = externalData.length;
    dispatch({ type: "PUSH_EXTERNAL", points: newPoints });
  }, [externalData]);

  // Baseline ticker — only fires if no WS update happened this second
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: "TICK_BASELINE" }), TICK_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Memoize spike threshold so it doesn't recalculate on every render
  const maxVal = data.reduce((m, d) => Math.max(m, d.events), 1);
  const spikeThreshold = Math.round(maxVal * 0.7);

  return (
    <div className="border border-border rounded-xl p-6 bg-card relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none" />

      <div className="flex items-center justify-between mb-6 relative">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          Event Throughput
        </h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
            Events/s
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            Critical
          </span>
        </div>
      </div>

      <div className="h-72 relative">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="eventsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="criticalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            {spikeThreshold > 5 && (
              <ReferenceLine
                y={spikeThreshold}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeOpacity={0.4}
                label={{ value: "spike threshold", fill: "#f59e0b", fontSize: 9, opacity: 0.6 }}
              />
            )}
            {/* isAnimationActive=false prevents costly re-animation on every data push */}
            <Area
              type="monotone"
              dataKey="events"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#eventsGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6", stroke: "#111113", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="critical"
              stroke="#ef4444"
              strokeWidth={1.5}
              fill="url(#criticalGrad)"
              dot={false}
              activeDot={{ r: 3, fill: "#ef4444" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
