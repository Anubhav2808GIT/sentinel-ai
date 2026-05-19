import { cn } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: string;
  className?: string;
  glow?: boolean;
}

export function SeverityBadge({ severity, className, glow = false }: SeverityBadgeProps) {
  const s = severity.toLowerCase();
  
  let colorClass = "bg-gray-500/10 text-gray-500 border-gray-500/20";
  let glowClass = "";
  
  if (s === "critical" || s === "fatal") {
    colorClass = "bg-red-500/10 text-red-500 border-red-500/30";
    glowClass = glow ? "glow-critical animate-pulse" : "";
  } else if (s === "high" || s === "error") {
    colorClass = "bg-orange-500/10 text-orange-500 border-orange-500/30";
    glowClass = glow ? "glow-high" : "";
  } else if (s === "medium" || s === "warn" || s === "warning") {
    colorClass = "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
  } else if (s === "low" || s === "info") {
    colorClass = "bg-blue-500/10 text-blue-500 border-blue-500/30";
  } else if (s === "resolved") {
    colorClass = "bg-green-500/10 text-green-500 border-green-500/30";
  }

  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap w-fit", colorClass, glowClass, className)}>
      {s === 'critical' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
      {s === 'high' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
      {severity.toUpperCase()}
    </span>
  );
}
