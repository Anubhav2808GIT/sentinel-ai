"use client";

/**
 * DeploymentBanner — shown in public cloud deployments.
 *
 * Controlled by NEXT_PUBLIC_IS_PUBLIC_DEMO env variable.
 * Renders a thin, dismissible banner explaining demo mode to recruiters/visitors.
 */

import { useState } from "react";
import { X, Globe, Cpu } from "lucide-react";

export function DeploymentBanner() {
  const [dismissed, setDismissed] = useState(false);
  const isPublicDemo = process.env.NEXT_PUBLIC_IS_PUBLIC_DEMO === "true";

  if (!isPublicDemo || dismissed) return null;

  return (
    <div
      role="banner"
      aria-label="Public demo banner"
      className="relative z-[300] flex items-center justify-between gap-3 px-4 py-2
                 bg-gradient-to-r from-violet-950/80 via-blue-950/80 to-violet-950/80
                 border-b border-violet-500/20 backdrop-blur-sm"
    >
      {/* Left: icon + message */}
      <div className="flex items-center gap-2 text-xs text-violet-200/90 min-w-0">
        <Globe className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="font-semibold text-violet-300 shrink-0">Public Demo</span>
        <span className="text-violet-300/60 hidden sm:inline">·</span>
        <span className="truncate hidden sm:inline">
          Live WebSocket stream active. AI analysis running in demo simulation mode — Ollama stays local.
        </span>
      </div>

      {/* Right: AI mode badge + dismiss */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full
                        bg-emerald-500/10 border border-emerald-500/20 text-emerald-400
                        text-[10px] font-mono font-semibold tracking-wider">
          <Cpu className="w-2.5 h-2.5" />
          AI DEMO MODE
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss banner"
          className="p-0.5 rounded text-violet-400/60 hover:text-violet-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
