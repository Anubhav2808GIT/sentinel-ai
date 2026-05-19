"""
Correlation engine — hardened for production.

Improvements vs original:
  - AI analysis is rate-limited: max N concurrent fire-and-forget tasks
  - AI analysis call has a strict timeout
  - publish_ws_event failures are caught and logged (not silently swallowed)
  - DB commits have error recovery
  - Structured logging with consistent context
"""

import asyncio
import uuid
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update

from shared.db.models import Incident, Event
from shared.db.session import async_session
from shared.logging.logger import get_logger
from shared.websocket.pubsub import publish_ws_event
from shared.metrics.prometheus import INCIDENTS_CREATED, PROCESSING_LATENCY

logger = get_logger("correlation-engine")

# ─── Config ────────────────────────────────────────────────────────────────────
CORRELATION_WINDOW_MINUTES = 5
AI_ANALYSIS_TIMEOUT_S = 90       # per-call timeout for AI service HTTP call
MAX_CONCURRENT_AI_CALLS = 5      # semaphore cap — prevents runaway AI task queue
AI_ANALYSIS_URL = "http://ai-analysis:8000/analyze"

_ai_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AI_CALLS)


# ─── Helpers ───────────────────────────────────────────────────────────────────
def _get_severity(level: str) -> str:
    level = level.upper()
    if level in {"ERROR", "CRITICAL", "FATAL"}:
        return "high"
    if level in {"WARNING", "WARN"}:
        return "medium"
    return "low"


def _is_similar(msg1: str, msg2: str) -> bool:
    """Lightweight fuzzy match — Jaccard similarity on word tokens."""
    words1 = set(msg1.lower().split())
    words2 = set(msg2.lower().split())
    if not words1 or not words2:
        return False
    intersection = words1 & words2
    return len(intersection) / max(len(words1), len(words2)) > 0.5


# ─── Main event processor ──────────────────────────────────────────────────────
async def process_event(event_data: dict, session: AsyncSession) -> Optional[Incident]:
    start = time.monotonic()
    service = event_data.get("service") or "unknown"
    level = event_data.get("level") or "INFO"
    message = event_data.get("message") or ""

    timestamp_str = event_data.get("timestamp")
    try:
        timestamp = (
            datetime.fromisoformat(timestamp_str) if timestamp_str else datetime.now(timezone.utc)
        )
    except Exception:
        timestamp = datetime.now(timezone.utc)

    severity = _get_severity(level)
    logger.debug("[engine] Processing event | service=%s severity=%s", service, severity)

    # ── Fetch open incidents for same service + severity ───────────────────────
    cutoff = timestamp - timedelta(minutes=CORRELATION_WINDOW_MINUTES)
    query = select(Incident).where(
        Incident.service == service,
        Incident.severity == severity,
        Incident.status != "resolved",
        Incident.last_seen >= cutoff,
    )
    result = await session.execute(query)
    active_incidents = result.scalars().all()

    # ── Correlate ──────────────────────────────────────────────────────────────
    correlated: Optional[Incident] = None
    for inc in active_incidents:
        first_evt_q = (
            select(Event)
            .where(Event.incident_id == inc.id)
            .order_by(Event.timestamp.asc())
            .limit(1)
        )
        evt_result = await session.execute(first_evt_q)
        first_evt = evt_result.scalar_one_or_none()
        if first_evt and _is_similar(message, first_evt.message):
            correlated = inc
            break

    if correlated:
        logger.info("[engine] Correlated → incident %s", correlated.id)
        correlated.event_count += 1
        correlated.last_seen = timestamp

        session.add(
            Event(
                incident_id=correlated.id,
                service=service,
                level=level,
                message=message,
                timestamp=timestamp,
            )
        )
        try:
            await session.commit()
            await session.refresh(correlated)
        except Exception as db_exc:
            logger.error("[engine] DB commit error (update): %s", db_exc)
            await session.rollback()
            return None

        published = await publish_ws_event(
            "incident_updated",
            {
                "incident_id": str(correlated.id),
                "event_count": correlated.event_count,
                "service": correlated.service,
                "severity": correlated.severity,
                "latest_message": message,
                "latest_level": level,
            },
        )
        if not published:
            logger.warning("[engine] WS publish failed for incident_updated %s", correlated.id)

        # AI re-analysis at event count milestones
        if correlated.event_count in {5, 10, 25}:
            asyncio.create_task(
                _trigger_ai_analysis(correlated.id, correlated.service, correlated.severity),
                name=f"ai-{correlated.id}",
            )

        PROCESSING_LATENCY.labels(service=service).observe(time.monotonic() - start)
        return correlated

    else:
        # ── New incident ───────────────────────────────────────────────────────
        logger.info("[engine] Creating new incident | service=%s severity=%s", service, severity)
        new_incident = Incident(
            id=uuid.uuid4(),
            service=service,
            severity=severity,
            status="active",
            event_count=1,
            first_seen=timestamp,
            last_seen=timestamp,
        )
        session.add(new_incident)

        try:
            await session.commit()
        except Exception as db_exc:
            logger.error("[engine] DB commit error (create incident): %s", db_exc)
            await session.rollback()
            return None

        session.add(
            Event(
                incident_id=new_incident.id,
                service=service,
                level=level,
                message=message,
                timestamp=timestamp,
            )
        )
        try:
            await session.commit()
        except Exception as db_exc:
            logger.error("[engine] DB commit error (create event): %s", db_exc)
            await session.rollback()

        INCIDENTS_CREATED.labels(service=service, severity=severity).inc()

        published = await publish_ws_event(
            "incident_created",
            {
                "incident_id": str(new_incident.id),
                "service": service,
                "severity": severity,
            },
        )
        if not published:
            logger.warning("[engine] WS publish failed for incident_created %s", new_incident.id)

        if severity in {"high", "critical"}:
            asyncio.create_task(
                _trigger_ai_analysis(new_incident.id, new_incident.service, new_incident.severity),
                name=f"ai-{new_incident.id}",
            )

        PROCESSING_LATENCY.labels(service=service).observe(time.monotonic() - start)
        return new_incident


# ─── AI Trigger (fire-and-forget, semaphore-gated) ────────────────────────────
async def _trigger_ai_analysis(incident_id: uuid.UUID, service: str, severity: str) -> None:
    """
    Fire-and-forget AI analysis with:
      - Independent DB session (prevents InterfaceError)
      - Semaphore cap (MAX_CONCURRENT_AI_CALLS)
      - Per-call timeout
      - Structured error logging
    """
    import httpx

    # Semaphore prevents queue explosion during burst traffic
    async with _ai_semaphore:
        try:
            async with async_session() as session:
                event_query = (
                    select(Event)
                    .where(Event.incident_id == incident_id)
                    .order_by(Event.timestamp.desc())
                    .limit(10)
                )
                evt_result = await session.execute(event_query)
                events = evt_result.scalars().all()

            payload = {
                "incident_id": str(incident_id),
                "service": service,
                "severity": severity,
                "events": [
                    {"level": e.level, "message": e.message, "timestamp": str(e.timestamp)}
                    for e in events
                ],
            }

            async with httpx.AsyncClient(timeout=AI_ANALYSIS_TIMEOUT_S) as client:
                response = await client.post(AI_ANALYSIS_URL, json=payload)
                if response.status_code < 500:
                    logger.info("[engine] AI analysis triggered for %s", incident_id)
                else:
                    logger.warning(
                        "[engine] AI analysis returned %d for %s",
                        response.status_code,
                        incident_id,
                    )

        except asyncio.TimeoutError:
            logger.error("[engine] AI analysis timed out for %s", incident_id)
        except Exception as exc:
            logger.warning("[engine] AI analysis call failed for %s: %s", incident_id, exc)
