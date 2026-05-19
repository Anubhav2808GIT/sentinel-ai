"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Using built-in default node type (no custom node) — avoids all v12 Handle/dimension issues.
// Custom styling is applied via the node's `style` prop.

const NODE_STYLE_BASE = {
  borderRadius: "10px",
  padding: "12px 16px",
  fontFamily: "monospace",
  fontSize: "12px",
  fontWeight: "bold",
  minWidth: "210px",
};

function nodeStyle(color: string) {
  return {
    ...NODE_STYLE_BASE,
    background: "#0f0f11",
    color,
    border: `1px solid ${color}55`,
    boxShadow: `0 0 18px ${color}22`,
  };
}

const initialNodes = [
  {
    id: "ingestion",
    position: { x: 50,  y: 240 },
    data: { label: "📥 Ingestion Service\nFastAPI · :8000" },
    style: nodeStyle("#94a3b8"),
  },
  {
    id: "redis",
    position: { x: 380, y: 240 },
    data: { label: "⚡ Redis Streams\nMessage Broker · :6379" },
    style: nodeStyle("#ef4444"),
  },
  {
    id: "event-processor",
    position: { x: 380, y: 400 },
    data: { label: "🔗 Event Processor\nCorrelation Engine · :8001" },
    style: nodeStyle("#a855f7"),
  },
  {
    id: "ai-analysis",
    position: { x: 710, y: 320 },
    data: { label: "🤖 AI Analysis\nFastAPI + Ollama · :8002" },
    style: nodeStyle("#10b981"),
  },
  {
    id: "ollama",
    position: { x: 710, y: 480 },
    data: { label: "🧠 Ollama LLM\nllama3.2 · :11434" },
    style: nodeStyle("#06b6d4"),
  },
  {
    id: "ws-gateway",
    position: { x: 380, y: 80 },
    data: { label: "🔌 WebSocket Gateway\nFastAPI · :8003" },
    style: nodeStyle("#3b82f6"),
  },
  {
    id: "frontend",
    position: { x: 710, y: 80 },
    data: { label: "🖥️ Next.js Frontend\nReact 18 · :3000" },
    style: nodeStyle("#e2e8f0"),
  },
  {
    id: "postgres",
    position: { x: 380, y: 560 },
    data: { label: "🗄️ PostgreSQL\nSQLAlchemy ORM · :5432" },
    style: nodeStyle("#f59e0b"),
  },
  {
    id: "prometheus",
    position: { x: 50,  y: 400 },
    data: { label: "📊 Prometheus\nMetrics scrape · :9090" },
    style: nodeStyle("#f97316"),
  },
  {
    id: "grafana",
    position: { x: 50,  y: 560 },
    data: { label: "📈 Grafana\nDashboards · :3001" },
    style: nodeStyle("#fb923c"),
  },
];

function mkEdge(
  id: string,
  source: string,
  target: string,
  color: string,
  animated = true,
  label?: string
) {
  return {
    id,
    source,
    target,
    animated,
    label,
    labelStyle: { fill: color, fontSize: 10, fontFamily: "monospace" },
    labelBgStyle: { fill: "#0f0f11", fillOpacity: 0.85 },
    style: { stroke: color, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}

const initialEdges = [
  mkEdge("e1",  "ingestion",       "redis",           "#ef4444", true,  "publish"),
  mkEdge("e2",  "redis",           "ws-gateway",      "#3b82f6", true,  "sub"),
  mkEdge("e3",  "ws-gateway",      "frontend",        "#3b82f6", true,  "WebSocket"),
  mkEdge("e4",  "redis",           "event-processor", "#a855f7", true,  "xread"),
  mkEdge("e5",  "event-processor", "ai-analysis",     "#10b981", true,  "HTTP"),
  mkEdge("e6",  "ai-analysis",     "ollama",          "#06b6d4", false, "generate"),
  mkEdge("e7",  "event-processor", "postgres",        "#f59e0b", false, "write"),
  mkEdge("e8",  "ai-analysis",     "postgres",        "#f59e0b", false, "write"),
  mkEdge("e9",  "ai-analysis",     "redis",           "#10b981", true,  "publish RCA"),
  mkEdge("e10", "prometheus",      "ingestion",       "#f97316", false, "scrape"),
  mkEdge("e11", "prometheus",      "event-processor", "#f97316", false, "scrape"),
  mkEdge("e12", "grafana",         "prometheus",      "#fb923c", false, "query"),
];

export default function ArchitectureFlow() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      colorMode="dark"
      style={{ background: "#0a0a0b" }}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#27272a"
      />
      <Controls
        style={{
          background: "#111113",
          border: "1px solid #27272a",
          borderRadius: "8px",
        }}
      />
      <MiniMap
        style={{
          background: "#111113",
          border: "1px solid #27272a",
          borderRadius: "8px",
        }}
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
  );
}
