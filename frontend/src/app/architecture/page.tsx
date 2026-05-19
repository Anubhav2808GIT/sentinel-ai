"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

// ─── ReactFlow must be dynamically imported with ssr:false ────────────────────
// It uses window/ResizeObserver/DOM APIs that don't exist on the server.
// A direct import causes a blank page (or hydration crash) in Next.js App Router.
const ArchitectureFlow = dynamic(
  () => import("./_flow"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm font-mono">Initialising topology…</span>
        </div>
      </div>
    ),
  }
);

export default function ArchitecturePage() {
  return (
    // h-screen (not min-h-screen) gives ReactFlow a concrete pixel height to measure
    <div className="h-screen bg-[#0a0a0b] flex flex-col relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-blue-500/5 blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-black/30 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold font-mono text-white tracking-tight">
              Architecture Topology
            </h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              Live operational data flow &amp; service mesh
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Legend */}
          <div className="hidden md:flex items-center gap-4 text-[11px] font-mono text-zinc-500">
            {[
              { color: "#3b82f6", label: "WebSocket" },
              { color: "#ef4444", label: "Redis Pub/Sub" },
              { color: "#a855f7", label: "Stream Consumer" },
              { color: "#10b981", label: "AI Pipeline" },
              { color: "#f59e0b", label: "Persistence" },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-mono text-green-400">TELEMETRY ACTIVE</span>
          </div>
        </div>
      </header>

      {/* ReactFlow canvas — fills all remaining space */}
      <div className="flex-1 relative z-10 overflow-hidden">
        <ArchitectureFlow />
      </div>
    </div>
  );
}
