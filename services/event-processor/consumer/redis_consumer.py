"""
Redis stream consumer — hardened for production.

Improvements vs original:
  - Exponential back-off on Redis read errors (was flat 5 s sleep)
  - CancelledError exits the inner loop cleanly (no stray error log)
  - Bounded per-message timeout (prevents single slow DB write from blocking the consumer)
  - Structured logging
"""

import asyncio
import json
import logging

from shared.utils.redis import get_redis_client
from shared.logging.logger import get_logger
from shared.db.session import async_session
from correlation.engine import process_event

logger = get_logger("redis-consumer")

# ─── Config ────────────────────────────────────────────────────────────────────
INITIAL_BACKOFF_S = 2
MAX_BACKOFF_S = 60
MESSAGE_PROCESS_TIMEOUT_S = 30   # max time allowed to process a single event
STREAM_KEY = "logs-stream"
BATCH_SIZE = 10
BLOCK_MS = 5_000


async def consume_logs() -> None:
    """
    Consume events from the Redis stream and hand them to the correlation engine.
    Reconnects automatically with exponential back-off on Redis failures.
    """
    logger.info("[consumer] Started log consumer")
    backoff = INITIAL_BACKOFF_S
    last_id = "$"

    while True:
        redis_client = None
        try:
            redis_client = get_redis_client()
            # Reset back-off on successful connect
            backoff = INITIAL_BACKOFF_S
            logger.info("[consumer] Connected to Redis stream '%s'", STREAM_KEY)

            while True:
                try:
                    events = await redis_client.xread(
                        {STREAM_KEY: last_id},
                        block=BLOCK_MS,
                        count=BATCH_SIZE,
                    )
                except asyncio.CancelledError:
                    logger.info("[consumer] Task cancelled — exiting")
                    return
                except Exception as read_exc:
                    logger.error("[consumer] Stream read error: %s", read_exc)
                    raise  # bubble to outer handler for reconnect

                if not events:
                    continue

                for _stream_name, messages in events:
                    for message_id, message_data in messages:
                        try:
                            raw = message_data.get("data")
                            if not raw:
                                last_id = message_id
                                continue

                            log_event = json.loads(raw)
                            logger.debug("[consumer] Processing message %s", message_id)

                            # Bounded processing timeout per message
                            async with async_session() as session:
                                await asyncio.wait_for(
                                    process_event(log_event, session),
                                    timeout=MESSAGE_PROCESS_TIMEOUT_S,
                                )

                        except asyncio.TimeoutError:
                            logger.error(
                                "[consumer] Timed out processing message %s — skipping",
                                message_id,
                            )
                        except asyncio.CancelledError:
                            logger.info("[consumer] Task cancelled mid-message — exiting")
                            return
                        except json.JSONDecodeError as json_exc:
                            logger.warning(
                                "[consumer] Malformed JSON in message %s: %s",
                                message_id,
                                json_exc,
                            )
                        except Exception as proc_exc:
                            logger.error(
                                "[consumer] Error processing message %s: %s",
                                message_id,
                                proc_exc,
                            )
                        finally:
                            # Always advance cursor — don't get stuck on a bad message
                            last_id = message_id

        except asyncio.CancelledError:
            logger.info("[consumer] Task cancelled — exiting")
            return
        except Exception as exc:
            logger.error(
                "[consumer] Redis error: %s. Reconnecting in %ds…",
                exc,
                backoff,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)
        finally:
            if redis_client:
                try:
                    await redis_client.aclose()
                except Exception:
                    pass
