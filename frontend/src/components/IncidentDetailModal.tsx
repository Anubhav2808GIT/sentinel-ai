import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, BrainCircuit, Activity, FileText, ChevronDown, ChevronUp, AlertTriangle, GitMerge, Zap, ShieldAlert, Cpu, CheckSquare } from "lucide-react";
import { ServiceIcon } from "@/lib/serviceIcons";
import { SeverityBadge } from "./SeverityBadge";

export type IncidentEvent = {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
};

export type AIAnalysisData = {
  summary: string;
  confidence: number;
  root_cause: string;
  remediation: string[];
};

export type IncidentDetail = {
  id: string;
  service: string;
  severity: "low" | "medium" | "high" | "critical" | "resolved" | "info" | "warning";
  status: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
  events: IncidentEvent[];
  ai_analysis?: AIAnalysisData;
};

export function IncidentDetailModal({ incidentId, onClose }: { incidentId: string | null, onClose: () => void }) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (!incidentId) return;
    
    let isMounted = true;
    
    // If it's a client-side DEMO incident, mock the data
    if (incidentId.startsWith("DEMO-")) {
      const match = incidentId.match(/DEMO-([A-Z0-9]+)-/);
      const serviceHint = match ? match[1] : "UNK";
      let service = "unknown-service";
      if (serviceHint === "DB-") service = "database-cluster";
      else if (serviceHint === "RED") service = "redis-cache";
      else if (serviceHint === "AUT") service = "auth-service";
      else if (serviceHint === "GAT") service = "gateway-api";
      
      const mockData: IncidentDetail = {
        id: incidentId,
        service: service,
        severity: "critical",
        status: "active",
        event_count: Math.floor(Math.random() * 100) + 40,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        events: [
          { id: "e1", timestamp: new Date().toISOString(), level: "CRITICAL", service, message: "Simulated cascading failure detected in demo environment." },
          { id: "e2", timestamp: new Date(Date.now() - 1000).toISOString(), level: "ERROR", service, message: "Resource saturation threshold exceeded." }
        ],
        ai_analysis: {
          summary: `[DEMO SIMULATION] Anomalous error rate spike detected across ${service}. Pattern suggests cascading failure originating from a dependency.`,
          confidence: 0.92,
          root_cause: "Simulated resource exhaustion triggering cascading retries.",
          remediation: [
            "Identify and isolate the failing upstream dependency.",
            "Enable circuit breaker on affected service.",
            "Review error budget and escalate to on-call team."
          ]
        }
      };
      
      setLoading(true);
      setTimeout(() => {
        if (isMounted) {
          setData(mockData);
          setLoading(false);
        }
      }, 600); // Simulate network delay
      return () => { isMounted = false; };
    }

    const fetchIncident = async () => {
      const rawUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";
      const url = typeof window !== "undefined" && rawUrl.includes("localhost") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
        ? rawUrl.replace("localhost", window.location.hostname)
        : rawUrl;

      setLoading(true);
      try {
        const res = await fetch(`${url}/incidents/${incidentId}`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted) setData(json);
        } else {
          console.warn(`[IncidentDetailModal] Failed to fetch incident ${incidentId} - Status: ${res.status}`);
          // On 404, we leave data as null which will show the fallback state
        }
      } catch (e) {
        console.error("[IncidentDetailModal] Network error fetching incident:", e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    
    fetchIncident();
    
    // Auto refresh while open
    const interval = setInterval(fetchIncident, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [incidentId]);

  return (
    <AnimatePresence>
      {incidentId && (
        <>
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-3xl bg-card border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {loading && !data ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : data ? (
              <>
                {/* Header */}
                <div className="p-6 border-b border-border bg-muted/20 flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <SeverityBadge severity={data.severity} glow={data.status !== "resolved"} />
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${data.status === 'resolved' ? 'border-green-500/30 text-green-500' : 'border-blue-500/30 text-blue-500'}`}>
                          {data.status.toUpperCase()}
                        </span>
                      </div>
                      <h2 className="text-2xl font-bold font-mono">INC-{data.id.split('-')[0].toUpperCase()}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm mt-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Service</span>
                      <span className="font-mono flex items-center gap-1.5"><ServiceIcon service={data.service} size={16}/> {data.service}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Total Events</span>
                      <span className="font-mono">{data.event_count}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Started</span>
                      <span className="font-mono">{format(new Date(data.first_seen), "HH:mm:ss.SSS")}</span>
                    </div>
                  </div>
                </div>
                
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-background">
                  
                  {/* AI Analysis Panel */}
                  <div className="rounded-xl border border-blue-500/30 bg-[#0A101F] shadow-[0_0_30px_rgba(59,130,246,0.1)] relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 blur-[100px] rounded-full translate-x-20 -translate-y-20 pointer-events-none" />
                    <div className="p-6 border-b border-blue-500/20">
                      <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-400">
                        <BrainCircuit className="w-5 h-5" />
                        AI Incident Intelligence
                      </h3>
                    </div>
                    
                    {data.ai_analysis ? (
                      <div className="p-6 space-y-6 relative z-10">
                        {/* Summary & Classification */}
                        <div className="flex gap-6 items-start">
                          <div className="flex-1 space-y-2">
                            <p className="text-foreground leading-relaxed text-sm">{data.ai_analysis.summary}</p>
                            <div className="flex flex-wrap gap-2 pt-2">
                              <span className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                                ⚠️ CASCADING_FAILURE
                              </span>
                              <span className="px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
                                🎯 HIGH_BLAST_RADIUS
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-500/5 border border-blue-500/20 w-32 h-32 relative">
                            <svg className="w-full h-full absolute inset-0 -rotate-90 transform" viewBox="0 0 100 100">
                              <circle cx="50" cy="50" r="40" fill="none" className="stroke-muted" strokeWidth="6" />
                              <motion.circle 
                                initial={{ strokeDasharray: "0 251.2" }}
                                animate={{ strokeDasharray: `${(data.ai_analysis.confidence || 0.85) * 251.2} 251.2` }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                                cx="50" cy="50" r="40" fill="none" className="stroke-blue-500" strokeWidth="6" strokeLinecap="round" 
                              />
                            </svg>
                            <span className="text-2xl font-bold font-mono text-blue-400 relative">
                              {((data.ai_analysis.confidence || 0.85) * 100).toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider relative mt-1">Confidence</span>
                          </div>
                        </div>
                        
                        {/* Root Cause Chain */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                            <GitMerge className="w-4 h-4 text-orange-500" /> Probable Root Cause Chain
                          </h4>
                          <div className="p-4 rounded-lg bg-card/50 border border-border relative">
                            <div className="absolute left-[31px] top-6 bottom-6 w-px bg-gradient-to-b from-red-500 via-orange-500 to-blue-500" />
                            <div className="space-y-4">
                              <div className="flex items-start gap-4 relative z-10">
                                <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center flex-shrink-0 text-red-400">
                                  <AlertTriangle className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="text-xs text-red-400 font-mono mb-1">ORIGIN</div>
                                  <p className="text-sm font-mono text-foreground">{data.ai_analysis.root_cause}</p>
                                </div>
                              </div>
                              <div className="flex items-start gap-4 relative z-10">
                                <div className="w-8 h-8 rounded-full bg-orange-500/20 border border-orange-500 flex items-center justify-center flex-shrink-0 text-orange-400">
                                  <Zap className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="text-xs text-orange-400 font-mono mb-1">PROPAGATION</div>
                                  <p className="text-sm font-mono text-muted-foreground">Resource saturation causes cascading timeouts across dependent services.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Impact Analysis */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 rounded-lg bg-card/50 border border-border">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                              <ShieldAlert className="w-4 h-4 text-orange-400" /> Blast Radius
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Affected Users</span>
                                <span className="font-mono text-red-400">~2,450 (Est.)</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Revenue Risk</span>
                                <span className="font-mono text-orange-400">High</span>
                              </div>
                              <div className="flex justify-between items-center text-sm pt-2 border-t border-border/50">
                                <span className="text-muted-foreground">Symptom</span>
                                <span className="font-mono text-xs text-foreground text-right max-w-[120px] truncate" title="Payment failures during checkout">Payment checkout fails</span>
                              </div>
                            </div>
                          </div>
                          <div className="p-4 rounded-lg bg-card/50 border border-border">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                              <Cpu className="w-4 h-4 text-blue-400" /> Affected Infra
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              <span className="px-2 py-1 rounded bg-muted text-xs font-mono border border-border">{data.service}</span>
                              <span className="px-2 py-1 rounded bg-muted text-xs font-mono border border-border">upstream-db</span>
                              <span className="px-2 py-1 rounded bg-muted text-xs font-mono border border-border">k8s-worker</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Playbook & Remediation */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide flex items-center gap-2">
                              <CheckSquare className="w-4 h-4 text-green-400" /> Operational Playbook
                            </h4>
                            <div className="p-4 rounded-lg bg-card/50 border border-border">
                              <ul className="space-y-3">
                                <li className="flex items-start gap-2 text-sm text-foreground">
                                  <input type="checkbox" className="mt-1" />
                                  <span>Check {data.service} CPU & Memory usage in Grafana</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm text-foreground">
                                  <input type="checkbox" className="mt-1" />
                                  <span>Inspect upstream connection pooling limits</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm text-foreground">
                                  <input type="checkbox" className="mt-1" />
                                  <span>Verify network latency to Redis</span>
                                </li>
                              </ul>
                            </div>
                          </div>
                          
                          <div>
                            <h4 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">AI Automated Remediation</h4>
                            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/10">
                              <ul className="space-y-2 mb-4">
                                {data.ai_analysis.remediation?.map((step: string, i: number) => (
                                  <li key={i} className="flex gap-2 text-sm">
                                    <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-mono text-xs border border-blue-500/30">{i+1}</span>
                                    <span className="text-blue-100/80">{step}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="pt-3 border-t border-blue-500/20 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Remediation Risk</span>
                                <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">LOW RISK</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 gap-4">
                        <div className="relative">
                          <div className="w-12 h-12 border-4 border-blue-500/20 rounded-full"></div>
                          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                        </div>
                        <span className="text-sm text-blue-400 font-mono animate-pulse">Correlating telemetry and generating insights...</span>
                      </div>
                    )}
                  </div>

                  {/* Fallback empty states to prevent blank screens on partial payloads */}
                  {!data.events || data.events.length === 0 ? (
                    <div className="p-6 text-center border border-dashed border-border rounded-xl bg-muted/10 text-muted-foreground text-sm">
                      No event telemetry available for this incident.
                    </div>
                  ) : null}

                  {/* Incident Relationships Graph (Placeholder) */}
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                      <GitMerge className="w-5 h-5" />
                      Incident Topography
                    </h3>
                    <div className="h-48 rounded-xl border border-border bg-[#0d0d0e] flex items-center justify-center relative overflow-hidden group">
                      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                      
                      {/* Simple CSS Graph Mockup */}
                      <div className="flex items-center gap-8 relative z-10">
                        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 flex flex-col items-center">
                          <span className="text-xs font-mono text-red-400">INC-8B92</span>
                          <span className="text-xs text-muted-foreground">database</span>
                        </div>
                        <div className="w-12 h-px bg-gradient-to-r from-red-500/50 to-orange-500/50 relative">
                          <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,1)] animate-ping" />
                        </div>
                        <div className="p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 flex flex-col items-center ring-2 ring-orange-500/50 shadow-[0_0_20px_rgba(249,115,22,0.2)]">
                          <span className="text-xs font-mono text-orange-400">INC-{data.id.split('-')[0].toUpperCase()}</span>
                          <span className="text-xs text-foreground">{data.service}</span>
                        </div>
                        <div className="w-12 h-px bg-gradient-to-r from-orange-500/50 to-blue-500/50"></div>
                        <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 flex flex-col items-center">
                          <span className="text-xs font-mono text-blue-400">INC-1A4C</span>
                          <span className="text-xs text-muted-foreground">gateway</span>
                        </div>
                      </div>
                      <div className="absolute bottom-4 left-4 right-4 flex justify-between text-[10px] text-muted-foreground font-mono uppercase">
                        <span>Upstream Failure</span>
                        <span>Current</span>
                        <span>Downstream Impact</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Timeline Visualization */}
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-4 border-b border-border pb-2">
                      <Activity className="w-5 h-5" />
                      Event Timeline
                    </h3>
                    <div className="relative pl-6 border-l border-border space-y-6">
                      {data.events?.slice().reverse().map((evt: IncidentEvent) => (
                        <div key={evt.id} className="relative">
                          <div className={`absolute -left-[29px] w-3 h-3 rounded-full border-2 border-background ${evt.level.toUpperCase() === 'CRITICAL' ? 'bg-red-500' : evt.level.toUpperCase() === 'ERROR' ? 'bg-orange-500' : 'bg-blue-500'}`} />
                          <div className="flex flex-col gap-1 -mt-1.5">
                            <span className="text-xs font-mono text-muted-foreground">
                              {format(new Date(evt.timestamp), "HH:mm:ss.SSS")}
                            </span>
                            <div className="p-3 rounded-lg bg-muted/30 border border-border font-mono text-sm break-all">
                              <span className="text-muted-foreground mr-2">[{evt.level}]</span>
                              {evt.message}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Raw Event Logs */}
                  <div className="border border-border rounded-xl overflow-hidden">
                    <button 
                      onClick={() => setShowLogs(!showLogs)}
                      className="w-full flex items-center justify-between p-4 bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Raw System Logs
                      </h3>
                      {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showLogs && (
                      <div className="p-4 bg-[#0d0d0e] text-[#a1a1aa] font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
                        <pre className="space-y-1">
                          {data.events?.map((evt: IncidentEvent) => (
                            <div key={evt.id} className="hover:bg-white/5 px-2 -mx-2 rounded">
                              <span className="text-[#71717a]">{evt.timestamp}</span>{" "}
                              <span className={evt.level === 'CRITICAL' ? 'text-red-400' : evt.level === 'ERROR' ? 'text-orange-400' : 'text-blue-400'}>{evt.level.padEnd(8)}</span>{" "}
                              <span className="text-purple-400">{evt.service.padEnd(20)}</span>{" "}
                              <span className="text-green-300">{evt.message}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              // ─── Graceful Empty / Not Found State ───
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-400">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold mb-2">Incident Not Found</h3>
                <p className="text-muted-foreground text-sm max-w-sm mb-6">
                  The incident data could not be retrieved. It may have been purged, or there is a network issue communicating with the backend.
                </p>
                <button 
                  onClick={onClose}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-medium transition-colors"
                >
                  Close Panel
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
