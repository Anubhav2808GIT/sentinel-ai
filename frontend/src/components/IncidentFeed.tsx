"use client";

import { memo, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Clock, ChevronRight, CheckCircle2 } from "lucide-react";
import { SeverityBadge } from "./SeverityBadge";
import { ServiceIcon } from "@/lib/serviceIcons";

export type IncidentType = {
  id: string;
  service: string;
  severity: "low" | "medium" | "high" | "critical" | "resolved" | "info" | "warning";
  status: string;
  event_count: number;
  last_seen: string;
  first_seen?: string;
};

// ─── Incident Feed (memoized) ─────────────────────────────────────────────────
export const IncidentFeed = memo(function IncidentFeed({
  incidents,
  onSelectIncident,
}: {
  incidents: IncidentType[];
  onSelectIncident: (id: string) => void;
}) {
  // Only show the most recent 30 — the full list is kept in the parent but
  // rendering 50+ animated cards is unnecessary
  const visible = useMemo(() => incidents.slice(0, 30), [incidents]);

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border bg-muted/20 flex justify-between items-center shrink-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500" />
          Live Incident Feed
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Streaming · {incidents.length}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {visible.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground text-sm">No active incidents</div>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                onSelect={onSelectIncident}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
});

// ─── Incident Card ────────────────────────────────────────────────────────────
// NOTE: `layout` prop removed — it triggers expensive layout recalculations for
//       every card whenever the list changes. Exit animations still work fine.
const IncidentCard = memo(function IncidentCard({
  incident,
  onSelect,
}: {
  incident: IncidentType;
  onSelect: (id: string) => void;
}) {
  const isResolved = incident.status === "resolved";

  return (
    <motion.div
      key={incident.id}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: isResolved ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.2 }}
      onClick={() => onSelect(incident.id)}
      className={`group p-3.5 rounded-lg border cursor-pointer transition-colors relative overflow-hidden ${
        isResolved
          ? "border-green-500/20 bg-green-500/5 hover:bg-green-500/10"
          : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SeverityBadge severity={isResolved ? "resolved" : incident.severity} glow={!isResolved} />
          <div className="flex items-center gap-1.5 min-w-0">
            <ServiceIcon service={incident.service} size={13} />
            <span className="font-mono text-xs text-foreground truncate">{incident.service}</span>
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {formatDistanceToNow(new Date(incident.last_seen), { addSuffix: true })}
        </span>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {isResolved ? (
            <span className="flex items-center gap-1 text-green-500">
              <CheckCircle2 className="w-3 h-3" />
              Resolved · {incident.event_count} events
            </span>
          ) : (
            <span>
              <span className="font-semibold text-foreground">{incident.event_count}</span>{" "}
              events correlated
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-medium text-blue-400 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0 duration-200">
          Inspect <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </motion.div>
  );
});
