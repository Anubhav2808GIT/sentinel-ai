import {
  Database,
  CreditCard,
  Shield,
  Bell,
  BarChart2,
  Globe,
  Zap,
  Server,
} from "lucide-react";
import { cn } from "./utils";

const SERVICE_MAP: Record<string, { icon: React.ElementType; color: string }> = {
  "database-cluster":    { icon: Database,  color: "text-amber-500"  },
  "payment-api":         { icon: CreditCard, color: "text-green-400"  },
  "auth-service":        { icon: Shield,    color: "text-blue-400"   },
  "notification-service":{ icon: Bell,      color: "text-pink-400"   },
  "analytics-worker":    { icon: BarChart2, color: "text-purple-400" },
  "gateway-api":         { icon: Globe,     color: "text-cyan-400"   },
  "redis":               { icon: Zap,       color: "text-yellow-400" },
};

export function getServiceMeta(service: string) {
  return SERVICE_MAP[service] ?? { icon: Server, color: "text-muted-foreground" };
}

export function ServiceIcon({
  service,
  className,
  size = 16,
}: {
  service: string;
  className?: string;
  size?: number;
}) {
  const { icon: Icon, color } = getServiceMeta(service);
  return <Icon width={size} height={size} className={cn(color, className)} />;
}
