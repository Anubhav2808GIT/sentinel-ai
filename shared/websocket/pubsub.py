"""
Shared Redis Pub/Sub utilities.

Fixes vs original:
  - Maintains a single shared Redis connection pool instead of creating a new
    client on every publish() call (the original leaked connections).
  - Structured logging for observability.
  - Publish returns success boolean for caller awareness.
"""

import json
import logging
import asyncio
from typing import Optional

import redis.asyncio as aioredis

from shared.config.settings import settings

logger = logging.getLogger("redis-pubsub")

WS_CHANNEL = "sentinel-ws-updates"

# ─── Shared connection pool ───────────────────────────────────────────────────
_pool: Optional[aioredis.ConnectionPool] = None
_lock = asyncio.Lock()


async def _get_pool() -> aioredis.ConnectionPool:
    """Lazily create and return a shared Redis connection pool."""
    global _pool
    async with _lock:
        if _pool is None:
            _pool = aioredis.ConnectionPool.from_url(
                f"redis://{settings.redis_host}:{settings.redis_port}",
                decode_responses=True,
                max_connections=20,
            )
            logger.info("[pubsub] Redis connection pool initialised (max=20)")
    return _pool


async def publish_ws_event(event_type: str, data: dict) -> bool:
    """
    Publishes a typed event to the WS broadcast channel.

    Returns True on success, False on failure (caller can log/retry).
    """
    payload = json.dumps({"type": event_type, **data})
    try:
        pool = await _get_pool()
        async with aioredis.Redis(connection_pool=pool) as redis:
            receivers = await redis.publish(WS_CHANNEL, payload)
            logger.debug(
                "[pubsub] Published %s → %d receiver(s)", event_type, receivers
            )
            return True
    except Exception as exc:
        logger.error("[pubsub] Failed to publish %s: %s", event_type, exc)
        return False


async def close_pool() -> None:
    """Gracefully close the shared pool on shutdown."""
    global _pool
    if _pool:
        await _pool.aclose()
        _pool = None
        logger.info("[pubsub] Redis connection pool closed")
