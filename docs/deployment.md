# SentinelAI — Production Deployment Guide

This document covers deploying SentinelAI to a public cloud environment. The architecture separates the stateless frontend from the stateful backend services to take advantage of the best available managed infrastructure at each layer.

---

## Deployment Topology

```
Internet
    │
    ├──► Vercel (Frontend — Next.js CDN edge)
    │         │
    │         ├──► REST API → Railway/Render (event-processor :8002)
    │         └──► WebSocket → Railway/Render (websocket-gateway :8003)
    │
    └──► Railway/Render (Backend Services)
              ├── ingestion-service
              ├── event-processor
              ├── ai-analysis
              ├── websocket-gateway
              ├── Managed PostgreSQL
              └── Managed Redis
```

---

## Recommended Stack

| Layer | Recommended Provider | Notes |
|-------|---------------------|-------|
| Frontend | **Vercel** | Zero-config Next.js deploy; global CDN; free tier available |
| Backend APIs | **Railway** or **Render** | Supports Docker Compose–style multi-service deploys |
| PostgreSQL | Railway Postgres / Neon / Supabase | Managed, backups included |
| Redis | Railway Redis / Upstash | Upstash is serverless; best for low-traffic demos |
| AI (Ollama) | Self-hosted GPU VM or disabled | Set `AI_DEMO_MODE=true` to skip; system degrades gracefully |

---

## Environment Variables

### Backend Services (`.env` / Railway/Render env panel)

```env
# ── PostgreSQL ───────────────────────────────────────────────────────────────
POSTGRES_USER=sentinel
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=sentinel_db
POSTGRES_HOST=<managed-postgres-host>
POSTGRES_PORT=5432

# Alternative: full connection URL
# DATABASE_URL=postgresql+asyncpg://sentinel:<password>@<host>:5432/sentinel_db

# ── Redis ───────────────────────────────────────────────────────────────────
REDIS_HOST=<managed-redis-host>
REDIS_PORT=6379
# REDIS_URL=redis://<user>:<password>@<host>:<port>

# ── AI / Ollama ─────────────────────────────────────────────────────────────
# Option A: disable Ollama, use graceful fallback
AI_DEMO_MODE=true
OLLAMA_BASE_URL=http://localhost:11434   # unused when AI_DEMO_MODE=true
OLLAMA_MODEL=qwen2.5

# Option B: external Ollama endpoint
# AI_DEMO_MODE=false
# OLLAMA_BASE_URL=https://your-ollama-host.example.com

# ── CORS ────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins
CORS_ORIGINS=https://your-app.vercel.app,https://sentinel-ai.vercel.app

# ── Observability ───────────────────────────────────────────────────────────
GF_SECURITY_ADMIN_PASSWORD=<strong-password>
GF_USERS_ALLOW_SIGN_UP=false

# ── Runtime ─────────────────────────────────────────────────────────────────
LOG_LEVEL=INFO
ENVIRONMENT=production
```

### Frontend (Vercel Environment Variables panel)

```env
NEXT_PUBLIC_API_URL=https://your-event-processor.railway.app
NEXT_PUBLIC_WS_URL=wss://your-websocket-gateway.railway.app/ws
```

> **Critical:** `NEXT_PUBLIC_WS_URL` must use `wss://` (TLS) in production, not `ws://`.

---

## Production Docker Deployment

For self-hosted environments (EC2, DigitalOcean Droplet, Fly.io machine):

```bash
# Clone and configure
git clone https://github.com/your-username/sentinel-ai.git
cd sentinel-ai
cp .env.production.example .env
# Edit .env with your managed service credentials

# Build and start with production overrides
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Verify all containers are healthy
docker compose ps
```

The `docker-compose.prod.yml` overlay adds:
- CPU/memory resource limits per service
- `healthcheck`-based startup dependency ordering (`condition: service_healthy`)
- Persistent Redis AOF for data durability
- Log file rotation (`json-file`, 10MB max, 3 files)

### Startup Order (guaranteed by health checks)

```
postgres (healthy)
    └── redis (healthy)
            ├── ingestion-service (healthy)
            ├── event-processor
            ├── ai-analysis (healthy)
            └── websocket-gateway (healthy)
                        └── frontend
```

### Persistent Volumes

```yaml
volumes:
  postgres_data:    # PostgreSQL data directory
  redis_data:       # Redis AOF persistence
  grafana_data:     # Grafana dashboards and datasources
  ollama_data:      # Downloaded Ollama models
```

---

## Step-by-Step Public Deployment (Railway + Vercel)

### Step 1 — Deploy Backend to Railway

1. Create a new Railway project
2. Add a **PostgreSQL** plugin and a **Redis** plugin
3. Create services for each backend container:
   - `ingestion-service`
   - `event-processor`
   - `ai-analysis`
   - `websocket-gateway`
4. Set all environment variables in each service's **Variables** panel (see table above)
5. Configure `CORS_ORIGINS` to include your Vercel frontend URL

### Step 2 — Expose Ports

In Railway, expose the following public URLs:
- `event-processor` → public HTTP domain (used as `NEXT_PUBLIC_API_URL`)
- `websocket-gateway` → public HTTP/WebSocket domain (used as `NEXT_PUBLIC_WS_URL`)

### Step 3 — Deploy Frontend to Vercel

```bash
cd frontend
npx vercel
```

Or connect the GitHub repository in the Vercel dashboard. Set:
```
Framework Preset: Next.js
Root Directory: frontend/
Build Command: npm run build
Output Directory: .next
```

Add the environment variables:
```
NEXT_PUBLIC_API_URL=https://<event-processor-domain>
NEXT_PUBLIC_WS_URL=wss://<websocket-gateway-domain>/ws
```

### Step 4 — Verify Health Endpoints

```bash
# Backend API
curl https://your-event-processor.railway.app/health

# WebSocket Gateway
curl https://your-websocket-gateway.railway.app/health

# Active incidents
curl https://your-event-processor.railway.app/incidents | jq '.incidents | length'
```

### Step 5 — Verify CORS

```bash
curl -i -X OPTIONS https://your-event-processor.railway.app/incidents \
  -H "Origin: https://your-app.vercel.app" \
  -H "Access-Control-Request-Method: GET"
# Expect: access-control-allow-origin: https://your-app.vercel.app
```

---

## Monitoring

### Prometheus (Local / Self-Hosted)

Prometheus scrapes metrics from all services. Access the UI at `http://localhost:9090`.

Key metrics:
```promql
# Incident creation rate
rate(sentinel_incidents_created_total[5m])

# Event processing latency (p99)
histogram_quantile(0.99, rate(sentinel_processing_latency_seconds_bucket[5m]))

# Active WebSocket connections
sentinel_ws_connections_total
```

### Grafana (Local / Self-Hosted)

Access at `http://localhost:3001` (default: `admin` / `admin`).

Pre-provisioned dashboards cover:
- **Incident throughput** — events/sec by service and severity
- **Processing latency** — correlation engine p50/p95/p99
- **WebSocket connections** — connection count over time

### Container Logs

```bash
# Tail all services
docker compose logs -f

# Single service
docker compose logs -f event-processor

# Last 100 lines
docker compose logs --tail=100 websocket-gateway
```

---

## Common Production Issues

### WebSocket Reconnect Loops

**Symptom:** Browser shows "RECONNECTING" status in rapid cycles.

**Causes & Fixes:**
- Load balancer WebSocket timeout — set idle timeout to ≥60s on your proxy
- Missing `Upgrade: websocket` header forwarding — enable WebSocket support in Railway/Render service settings
- `websocket-gateway` crash — check logs for `AttributeError` or Redis connection errors

### Redis Unavailable

**Symptom:** `event-processor` and `websocket-gateway` fail to start or log Redis connection errors.

**Fix:** Verify `REDIS_HOST` and `REDIS_PORT` match the managed Redis service. Test:
```bash
docker exec -it redis redis-cli ping
# Expected: PONG
```

### Ollama Unavailable

**Symptom:** AI analysis shows `"AI analysis unavailable (http_error)"` in incident detail panels.

**Fix:** This is expected if Ollama is not running. Set `AI_DEMO_MODE=true` in your environment to suppress error logs. All other platform features operate normally.

### CORS Blocked in Browser

**Symptom:** Browser console shows `"Access to fetch blocked by CORS policy"`.

**Fix:**
1. Ensure `CORS_ORIGINS` in `event-processor` includes the exact frontend URL (no trailing slash)
2. Rebuild the `event-processor` container after changing env vars — `restart` alone does not reload environment
3. Confirm the preflight returns 200: `curl -i -X OPTIONS <api-url> -H "Origin: <frontend-url>"`

### Frontend Hydration Mismatch

**Symptom:** Next.js logs `"Hydration failed"` or `"Text content does not match server-rendered HTML"`.

**Cause:** Using `window.location` or other browser APIs in server-rendered components.

**Fix:** All browser API access in `page.tsx` is guarded with `typeof window !== "undefined"`. Verify no `"use client"` boundary was accidentally removed.

---

## Scaling Notes

| Component | Horizontal Scaling Approach |
|-----------|----------------------------|
| `ingestion-service` | Stateless — add instances freely; all write to the same Redis Stream |
| `event-processor` | Use Redis Streams **consumer groups** to distribute partitions across instances |
| `websocket-gateway` | Requires Redis Pub/Sub adapter (already in place) — add instances behind a load balancer with sticky sessions or shared Pub/Sub |
| PostgreSQL | Vertical scaling + read replicas for analytics; use connection pooling (PgBouncer) at scale |
| Redis | Cluster mode or managed Redis with replication for HA |

> **Important:** The `websocket-gateway` uses an in-process `ConnectionManager`. Multiple instances require a shared state mechanism. The existing Redis Pub/Sub relay (`shared/websocket/pubsub.py`) provides the correct foundation — each gateway instance subscribes to the same channel, ensuring all clients receive all broadcasts regardless of which instance they connect to.

---

## Health Check Reference

| Endpoint | Service | Expected Response |
|----------|---------|------------------|
| `GET /health` | ingestion-service | `{"status": "healthy"}` |
| `GET /health` | event-processor | `{"status": "healthy"}` |
| `GET /health` | ai-analysis | `{"status": "healthy"}` |
| `GET /health` | websocket-gateway | `{"status": "healthy", "active_connections": N}` |
| `GET /metrics` | all services | Prometheus text format |
