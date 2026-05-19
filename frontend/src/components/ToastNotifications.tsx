"use client";

import { useEffect, useRef, useState, memo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertOctagon } from "lucide-react";
import { ServiceIcon } from "@/lib/serviceIcons";
import { formatDistanceToNow } from "date-fns";

export interface Toast {
  id: string;
  incidentId: string;
  service: string;
  severity: string;
  timestamp: Date;
}

interface ToastNotificationsProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onOpen: (incidentId: string) => void;
}

export function ToastNotifications({ toasts, onDismiss, onOpen }: ToastNotificationsProps) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
      <AnimatePresence mode="sync">
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            onOpen={onOpen}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── DURATION in ms ──────────────────────────────────────────────────────────
const DURATION = 6000;

/**
 * ToastCard — uses CSS animation for progress bar instead of a 50ms setInterval.
 * This eliminates 20 JS re-renders/second per toast.
 * The dismiss logic uses a single setTimeout.
 */
const ToastCard = memo(function ToastCard({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  onOpen: (incidentId: string) => void;
}) {
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef(DURATION);
  const startRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  // Start / resume countdown
  const scheduleTimer = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, remainingRef.current);
  }, [dismiss]);

  // Pause countdown
  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingRef.current -= Date.now() - startRef.current;
    setIsPaused(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPaused(false);
    scheduleTimer();
  }, [scheduleTimer]);

  useEffect(() => {
    scheduleTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduleTimer]);

  const isCritical = toast.severity === "critical" || toast.severity === "high";

  return (
    <motion.div
      initial={{ opacity: 0, x: 80, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.92, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="pointer-events-auto w-[360px] relative overflow-hidden rounded-xl border shadow-2xl cursor-pointer bg-[#0f0f11]"
      style={{
        borderColor: isCritical ? "rgba(239,68,68,0.35)" : "rgba(249,115,22,0.3)",
        boxShadow: isCritical
          ? "0 0 20px rgba(239,68,68,0.18), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 0 16px rgba(249,115,22,0.12), 0 4px 20px rgba(0,0,0,0.6)",
      }}
      onClick={() => { onOpen(toast.incidentId); dismiss(); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Glowing top border */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: isCritical
            ? "linear-gradient(90deg, transparent, rgba(239,68,68,0.8), transparent)"
            : "linear-gradient(90deg, transparent, rgba(249,115,22,0.6), transparent)",
        }}
      />

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 p-1.5 rounded-lg ${isCritical ? "bg-red-500/15" : "bg-orange-500/15"}`}>
            <AlertOctagon className={`w-4 h-4 ${isCritical ? "text-red-500" : "text-orange-500"}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-bold tracking-widest uppercase ${isCritical ? "text-red-500" : "text-orange-500"}`}>
                {toast.severity} incident
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(toast.timestamp, { addSuffix: true })}
              </span>
            </div>

            <div className="flex items-center gap-2 mb-1">
              <ServiceIcon service={toast.service} size={13} />
              <span className="font-mono text-sm text-foreground font-semibold truncate">
                {toast.service}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              New incident detected — click to investigate
            </p>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar — CSS animation, zero JS re-renders */}
      <div className="h-[2px] bg-muted/30 relative overflow-hidden">
        <div
          className={`absolute inset-0 h-full ${isCritical ? "bg-red-500" : "bg-orange-500"} toast-progress`}
          style={{
            animationDuration: `${DURATION}ms`,
            animationPlayState: isPaused ? "paused" : "running",
          }}
        />
      </div>
    </motion.div>
  );
});
