"""
AI Analysis Service — hardened for production.

Improvements vs original:
  - Overall request timeout guard (prevents runaway Ollama calls from blocking the event loop)
  - Malformed / partial AI response handling
  - DB session cleanup on all code paths
  - Structured exception logging with context
  - Analysis already-in-progress guard (prevents duplicate concurrent runs)
  - Health endpoint now reports Ollama reachability
  - AI_DEMO_MODE: when True, skips Ollama and returns a rich simulated analysis
  - CORS origins from settings (production-safe)
"""

import asyncio
import logging
import random

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from llm.client import OllamaClient
from prompts.templates import INCIDENT_ANALYSIS_PROMPT
from shared.config.settings import settings
from shared.logging.logger import get_logger
from shared.db.session import get_db_session
from shared.db.models import AIAnalysis
from shared.metrics.prometheus import (
    metrics_endpoint,
    AI_ANALYSIS_REQUESTS,
    AI_ANALYSIS_FAILURES,
)
from shared.websocket.pubsub import publish_ws_event

logger = get_logger("ai-analysis")
app = FastAPI(title="SentinelAI AI Analysis Service")
llm_client = OllamaClient()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.ai_demo_mode:
    logger.info("[ai-analysis] Running in AI_DEMO_MODE — Ollama disabled, using simulated responses")

# Track in-progress analyses to prevent duplicate concurrent runs
_in_progress: set[str] = set()

# Max time we allow for the entire analysis pipeline (LLM + DB)
ANALYSIS_TIMEOUT_S = 120

# ─── Demo AI Analysis (used when AI_DEMO_MODE=true) ─────────────────────────
_DEMO_ANALYSES = {
    "database-cluster": {
        "summary": "PostgreSQL connection pool exhausted due to unclosed long-running transactions originating from the payment-service. Downstream read replicas are experiencing replication lag >2s, causing stale-read errors for the auth-service and gateway.",
        "root_cause": "Connection pool saturation (max_connections=100 exceeded) triggered by payment-service batch job holding idle transactions open for >30s.",
        "remediation": [
            "Immediately terminate idle transactions: SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < NOW() - INTERVAL '30s';",
            "Increase connection pool size or enable PgBouncer connection pooling.",
            "Add statement_timeout=15000 to payment-service DB config.",
            "Review and add connection release logic to batch job runner.",
            "Scale read replicas to distribute read load from auth-service.",
        ],
        "confidence": 0.91,
    },
    "redis-cache": {
        "summary": "Redis memory limit reached (maxmemory policy: allkeys-lru). Session keys are being evicted faster than they are written, causing auth-service to fall back to direct DB session validation on every request — increasing DB load by ~340%.",
        "root_cause": "Redis maxmemory threshold (512MB) hit due to unbounded session key TTL introduced in auth-service v2.3.1 deploy.",
        "remediation": [
            "Immediately flush stale session keys: redis-cli --scan --pattern 'sess:*' | xargs redis-cli DEL",
            "Rollback auth-service to v2.3.0 to restore TTL enforcement.",
            "Increase Redis maxmemory to 2GB or add a second Redis instance for session isolation.",
            "Implement session key TTL cap (max 3600s) in auth-service session middleware.",
            "Add Redis memory utilisation alert at 70% threshold.",
        ],
        "confidence": 0.88,
    },
    "auth-service": {
        "summary": "JWT validation failure storm caused by a clock skew of >5min between auth-service pods and the token-issuer service after a pod restart. Gateway is receiving 401s on all authenticated routes, causing cascading retry amplification.",
        "root_cause": "NTP sync failure on auth-service-pod-3 after node drain. JWT 'nbf' (not before) claim validation is rejecting valid tokens due to clock skew.",
        "remediation": [
            "Drain and reschedule auth-service-pod-3 to restore NTP sync.",
            "Add clock skew tolerance of ±30s to JWT validation middleware.",
            "Implement circuit breaker on gateway to stop retry amplification (fail fast after 3 consecutive 401s per user).",
            "Add clock skew monitoring alert via Prometheus node_timex_offset_seconds.",
        ],
        "confidence": 0.94,
    },
    "gateway-api": {
        "summary": "API Gateway experiencing cascading timeout failures due to upstream auth-service degradation. Connection pool to auth-service is saturated; gateway worker threads are blocking on auth validation, causing request queue buildup.",
        "root_cause": "Gateway timeout config (30s) is too high for degraded auth-service (p99 latency: 28s). Workers are all occupied waiting for auth, blocking all new requests.",
        "remediation": [
            "Reduce gateway→auth-service timeout to 3s immediately.",
            "Enable bulkhead isolation: separate thread pool for auth validation requests.",
            "Add health-check-based circuit breaker: open circuit if auth-service error rate >20% in 10s window.",
            "Implement graceful degradation: allow cached-credential bypass for read-only endpoints during auth outage.",
        ],
        "confidence": 0.87,
    },
}

_DEFAULT_DEMO_ANALYSIS = {
    "summary": "Anomalous error rate spike detected across {service}. Pattern suggests cascading failure originating from a dependency. Event correlation indicates {event_count} related signals within the observation window.",
    "root_cause": "Upstream dependency failure causing retry amplification and connection pool exhaustion.",
    "remediation": [
        "Identify and isolate the failing upstream dependency.",
        "Enable circuit breaker on affected service.",
        "Review error budget and escalate to on-call team.",
        "Check Grafana dashboards for correlated metric spikes.",
    ],
    "confidence": 0.72,
}


def _demo_analysis(service: str, severity: str, event_count: int) -> dict:
    """Return a realistic simulated analysis — used in AI_DEMO_MODE."""
    base = _DEMO_ANALYSES.get(service, _DEFAULT_DEMO_ANALYSIS).copy()
    # Personalise the default template
    if "summary" in base and "{service}" in base["summary"]:
        base["summary"] = base["summary"].format(service=service, event_count=event_count)
    # Bump confidence slightly for critical severity
    if severity in ("critical", "high"):
        base["confidence"] = min(1.0, base.get("confidence", 0.72) + 0.04)
    return base


# ─── Models ───────────────────────────────────────────────────────────────────
class AnalysisRequest(BaseModel):
    incident_id: str
    service: str
    severity: str
    events: List[dict]


app.get("/metrics")(metrics_endpoint)


@app.get("/")
async def root():
    return {"service": "ai-analysis", "status": "running"}


@app.get("/health")
async def health():
    """Liveness probe — also sanity-checks that Ollama is reachable (skipped in demo mode)."""
    import httpx

    if settings.ai_demo_mode:
        return {
            "status": "healthy",
            "mode": "demo",
            "ollama_reachable": False,
            "analyses_in_progress": len(_in_progress),
        }

    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_base_url}/")
            ollama_ok = r.status_code < 500
    except Exception:
        pass

    return {
        "status": "healthy",
        "mode": "live",
        "ollama_reachable": ollama_ok,
        "analyses_in_progress": len(_in_progress),
    }


@app.post("/analyze")
async def analyze_incident(
    req: AnalysisRequest,
    session: AsyncSession = Depends(get_db_session),
):
    AI_ANALYSIS_REQUESTS.inc()
    logger.info("Analysis requested for incident %s (service=%s)", req.incident_id, req.service)

    # ── Duplicate guard ────────────────────────────────────────────────────────
    if req.incident_id in _in_progress:
        logger.info("Analysis already in progress for %s — skipping", req.incident_id)
        return {"status": "already_in_progress"}

    # ── Cache check ────────────────────────────────────────────────────────────
    try:
        query = select(AIAnalysis).where(AIAnalysis.incident_id == req.incident_id)
        result = await session.execute(query)
        existing = result.scalar_one_or_none()
        if existing:
            logger.info("Returning cached analysis for %s", req.incident_id)
            return existing
    except Exception as exc:
        logger.error("Cache check failed for %s: %s", req.incident_id, exc)
        # Non-fatal — continue to fresh analysis

    # ── LLM analysis with overall timeout ─────────────────────────────────────
    _in_progress.add(req.incident_id)
    try:
        recent_events = req.events[-5:] if len(req.events) > 5 else req.events
        events_summary = "\n".join(
            [f"- [{e.get('level', '?')}] {e.get('message', '?')}" for e in recent_events]
        )

        # ── Demo AI Mode: skip Ollama, return rich simulated analysis ──────────
        if settings.ai_demo_mode:
            logger.info("[ai-analysis] Demo mode — generating simulated RCA for %s", req.incident_id)
            await asyncio.sleep(random.uniform(0.8, 2.5))  # realistic latency sim
            analysis_result = _demo_analysis(req.service, req.severity, len(req.events))
        else:
            prompt = INCIDENT_ANALYSIS_PROMPT.format(
                service=req.service,
                severity=req.severity,
                event_count=len(req.events),
                events_summary=events_summary,
            )

            try:
                analysis_result = await asyncio.wait_for(
                    llm_client.generate_json(prompt),
                    timeout=ANALYSIS_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "LLM analysis timed out after %ds for incident %s",
                    ANALYSIS_TIMEOUT_S,
                    req.incident_id,
                )
                AI_ANALYSIS_FAILURES.inc()
                analysis_result = llm_client._fallback_response()

        # ── Validate / normalise response ──────────────────────────────────────
        if not isinstance(analysis_result, dict):
            logger.warning("Non-dict LLM response for %s — using fallback", req.incident_id)
            analysis_result = llm_client._fallback_response()

        summary = str(analysis_result.get("summary", "Analysis unavailable."))[:2000]
        root_cause = str(analysis_result.get("root_cause", "Unknown"))[:1000]
        remediation = analysis_result.get("remediation", ["Investigate logs manually."])
        if not isinstance(remediation, list):
            remediation = [str(remediation)]
        remediation = [str(s)[:500] for s in remediation[:10]]
        try:
            confidence = float(analysis_result.get("confidence", 0.0))
            confidence = max(0.0, min(1.0, confidence))
        except (TypeError, ValueError):
            confidence = 0.0

        # ── Persist ────────────────────────────────────────────────────────────
        try:
            db_analysis = AIAnalysis(
                incident_id=req.incident_id,
                summary=summary,
                root_cause=root_cause,
                remediation=remediation,
                confidence=confidence,
            )
            session.add(db_analysis)
            await session.commit()
        except Exception as db_exc:
            logger.error("DB persist failed for %s: %s", req.incident_id, db_exc)
            await session.rollback()

        # ── Notify WS subscribers ──────────────────────────────────────────────
        try:
            await publish_ws_event(
                "analysis_completed",
                {"incident_id": req.incident_id, "confidence": confidence},
            )
        except Exception as pub_exc:
            logger.warning("WS publish failed for %s: %s", req.incident_id, pub_exc)

        return {
            "summary": summary,
            "root_cause": root_cause,
            "remediation": remediation,
            "confidence": confidence,
        }

    except Exception as exc:
        AI_ANALYSIS_FAILURES.inc()
        logger.exception("Unexpected error analysing %s: %s", req.incident_id, exc)
        raise HTTPException(status_code=500, detail="Failed to analyze incident")
    finally:
        _in_progress.discard(req.incident_id)
