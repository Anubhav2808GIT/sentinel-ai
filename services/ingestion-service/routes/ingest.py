from fastapi import APIRouter, HTTPException, BackgroundTasks
from shared.schemas.events import LogEvent
from shared.utils.redis import get_redis_client
from shared.logging.logger import get_logger
from shared.metrics.prometheus import EVENTS_INGESTED
import json

router = APIRouter()
logger = get_logger("ingestion-service")

@router.post("/logs")
async def ingest_log(log: LogEvent):
    logger.info(f"Received log event from {log.service}")
    
    redis_client = get_redis_client()
    try:
        # Convert datetime to ISO format string for JSON serialization
        event_data = log.model_dump()
        event_data["timestamp"] = event_data["timestamp"].isoformat()
        
        await redis_client.xadd(
            "logs-stream",
            {"data": json.dumps(event_data)}
        )
        logger.info(f"Successfully queued log event from {log.service}")
        EVENTS_INGESTED.labels(service=log.service, level=log.level).inc()
        
        return {
            "status": "queued",
            "event": event_data
        }
    except Exception as e:
        logger.error(f"Failed to queue log event: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to queue event")
    finally:
        await redis_client.aclose()
