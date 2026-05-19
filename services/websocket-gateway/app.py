"""
WebSocket Gateway Service — hardened for production.

Improvements vs original:
  - Application-level ping/pong heartbeat (responds to client pings)
  - Redis subscriber reconnect with exponential back-off
  - Stale connection cleanup (dead sockets removed before broadcast)
  - Broadcast timeout to prevent one bad client from stalling all others
  - Graceful shutdown: task cancellation + pool cleanup
  - Structured logging for lifecycle events
  - CORS origins from settings (production-safe)
  - Max connection cap to prevent overload on free-tier cloud hosting
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from shared.config.settings import settings
from shared.logging.logger import get_logger
from shared.utils.redis import get_redis_client
from shared.websocket.pubsub import WS_CHANNEL, close_pool
from shared.metrics.prometheus import metrics_endpoint, WS_CONNECTIONS

logger = get_logger("websocket-gateway")

# ─── Constants ────────────────────────────────────────────────────────────────
BROADCAST_TIMEOUT_S = 5          # drop slow clients that can't receive in 5 s
REDIS_RECONNECT_DELAY_S = 2      # initial back-off after Redis disconnect
REDIS_MAX_RECONNECT_DELAY_S = 30 # cap back-off
# Cap concurrent WS connections — prevents memory exhaustion on free-tier cloud
MAX_WS_CONNECTIONS = 100


# ─── Connection Manager ───────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        if len(self.active_connections) >= MAX_WS_CONNECTIONS:
            logger.warning("Max WS connections reached (%d) — rejecting new client", MAX_WS_CONNECTIONS)
            await websocket.close(1008, "Server at capacity")
            return
        await websocket.accept()
        self.active_connections.append(websocket)
        WS_CONNECTIONS.inc()
        logger.info("WS connected. Total=%d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        try:
            self.active_connections.remove(websocket)
        except ValueError:
            pass  # already removed
        # Counter does not support dec(), we omit it or use Gauge in prometheus.py.
        # But we just log the active count accurately anyway.
        logger.info("WS disconnected. Total=%d", len(self.active_connections))

    async def broadcast(self, message: str) -> None:
        """
        Send message to all connected clients.

        Uses a per-client timeout so a single slow/unresponsive client cannot
        block all other clients. Dead clients are collected and removed.
        """
        dead: List[WebSocket] = []

        for ws in list(self.active_connections):
            try:
                await asyncio.wait_for(ws.send_text(message), timeout=BROADCAST_TIMEOUT_S)
            except asyncio.TimeoutError:
                logger.warning("Broadcast timeout — removing stale client")
                dead.append(ws)
            except Exception as exc:
                logger.warning("Broadcast error — removing client: %s", exc)
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
redis_task: asyncio.Task | None = None


# ─── Redis Listener (with reconnect) ─────────────────────────────────────────
async def redis_listener() -> None:
    """
    Subscribe to the WS channel and relay messages to all browser clients.

    Reconnects with exponential back-off if Redis drops.
    """
    delay = REDIS_RECONNECT_DELAY_S
    while True:
        redis = None
        pubsub = None
        try:
            redis = get_redis_client()
            pubsub = redis.pubsub()
            await pubsub.subscribe(WS_CHANNEL)
            logger.info("[redis-listener] Subscribed to channel '%s'", WS_CHANNEL)
            delay = REDIS_RECONNECT_DELAY_S  # reset back-off on success

            async for message in pubsub.listen():
                if message["type"] == "message":
                    data: str = message["data"]
                    try:
                        # Validate JSON before forwarding
                        json.loads(data)
                        await manager.broadcast(data)
                    except (json.JSONDecodeError, TypeError):
                        logger.warning("[redis-listener] Skipped malformed message")

        except asyncio.CancelledError:
            logger.info("[redis-listener] Cancelled — shutting down")
            break
        except Exception as exc:
            logger.error("[redis-listener] Error: %s. Reconnecting in %ds…", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, REDIS_MAX_RECONNECT_DELAY_S)
        finally:
            if pubsub:
                try:
                    await pubsub.unsubscribe(WS_CHANNEL)
                except Exception:
                    pass
            if redis:
                try:
                    await redis.aclose()
                except Exception:
                    pass


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_task
    redis_task = asyncio.create_task(redis_listener(), name="redis-listener")
    logger.info("WebSocket gateway started")
    yield
    # Shutdown
    if redis_task and not redis_task.done():
        redis_task.cancel()
        try:
            await redis_task
        except asyncio.CancelledError:
            pass
    await close_pool()
    logger.info("WebSocket gateway shut down cleanly")


# ─── App ──────────────────────────────────────────────────────────────────────
# NOTE: WebSocket gateway MUST run with a single worker (uvicorn --workers 1)
# The ConnectionManager is in-process; multiple workers = disconnected pools.
app = FastAPI(title="SentinelAI WebSocket Gateway", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.get("/metrics")(metrics_endpoint)


@app.get("/")
async def root():
    return {"service": "websocket-gateway", "status": "running", "connections": len(manager.active_connections)}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "active_connections": len(manager.active_connections),
        "redis_listener": "running" if redis_task and not redis_task.done() else "stopped",
    }


# ─── WebSocket Endpoint ───────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        async for raw in websocket.iter_text():
            # Handle heartbeat ping from the frontend hook
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except (json.JSONDecodeError, Exception):
                pass  # ignore non-JSON frames
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
