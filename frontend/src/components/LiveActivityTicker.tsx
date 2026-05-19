"use client";

import { memo, useEffect, useRef } from "react";
import { format } from "date-fns";

export type TickerEvent = {
  id: string;
  message: string;
  timestamp: Date;
  level: "info" | "warning" | "error" | "critical";
};

const LEVEL_COLOR: Record<TickerEvent["level"], string> = {
  critical: "text-red-400 font-semibold",
  error:    "text-orange-400",
  warning:  "text-amber-400",
  info:     "text-blue-300",
};

/**
 * LiveActivityTicker — performance-optimised.
 *
 * Changes from original:
 *  - Removed AnimatePresence / motion.div from event list (was animating all 30+ items every update)
 *  - Uses CSS `@keyframes` slide-in on the newest item only (data-new attribute)
 *  - Auto-scrolls to the right via useEffect ref
 *  - Memoized to prevent parent re-render propagation
 */
export const LiveActivityTicker = memo(function LiveActivityTicker({
  events,
}: {
  events: TickerEvent[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(events.length);

  // Scroll to newest item on new events only
  useEffect(() => {
    if (events.length === prevLenRef.current) return;
    prevLenRef.current = events.length;
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [events]);

  const newestId = events.length > 0 ? events[events.length - 1].id : null;

  return (
    <div className="w-full bg-card border-b border-border/50 h-8 flex items-center px-4 overflow-hidden relative">
      {/* Label */}
      <div className="flex items-center gap-2 pr-4 border-r border-border/50 z-10 bg-card shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase whitespace-nowrap">
          Live Feed
        </span>
      </div>

      {/* Scrollable event list */}
      <div
        ref={containerRef}
        className="flex items-center gap-6 overflow-x-auto scrollbar-hide whitespace-nowrap pl-4 flex-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {events.map((evt) => (
          <div
            key={evt.id}
            className={`flex items-center gap-2 text-xs font-mono ticker-item ${
              evt.id === newestId ? "ticker-item-new" : ""
            }`}
          >
            <span className="text-muted-foreground">
              [{format(evt.timestamp, "HH:mm:ss")}]
            </span>
            <span className={LEVEL_COLOR[evt.level]}>{evt.message}</span>
          </div>
        ))}
      </div>

      {/* Right fade */}
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-card to-transparent pointer-events-none" />
    </div>
  );
});
