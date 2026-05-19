from fastapi import FastAPI, HTTPException, Depends
import asyncio
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from consumer.redis_consumer import consume_logs
from shared.logging.logger import get_logger
from shared.config.settings import settings
from shared.db.session import get_db_session, engine
from shared.db.models import Base, Incident, Event, AIAnalysis
from shared.metrics.prometheus import metrics_endpoint
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import selectinload


logger = get_logger("event-processor")

consumer_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables for rapid prototyping (use Alembic in real prod)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    global consumer_task
    logger.info("Starting background consumer task")
    consumer_task = asyncio.create_task(consume_logs())
    yield
    if consumer_task:
        logger.info("Cancelling background consumer task")
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="SentinelAI Event Processor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.get("/metrics")(metrics_endpoint)

@app.get("/")
async def root():
    return {
        "service": "event-processor",
        "status": "running"
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/stats")
async def get_stats(session: AsyncSession = Depends(get_db_session)):
    active_incidents = await session.scalar(
        select(func.count(Incident.id)).where(Incident.status != "resolved")
    )
    total_events = await session.scalar(select(func.count(Event.id)))
    analyses_completed = await session.scalar(select(func.count(AIAnalysis.id)))
    
    return {
        "activeIncidents": active_incidents or 0,
        "totalEvents": total_events or 0,
        "analysesCompleted": analyses_completed or 0
    }

@app.get("/incidents")
async def list_incidents(session: AsyncSession = Depends(get_db_session)):
    query = select(Incident).order_by(Incident.last_seen.desc()).limit(100)
    result = await session.execute(query)
    incidents = result.scalars().all()
    return {"incidents": incidents}

@app.get("/incidents/{incident_id}")
async def get_incident_by_id(incident_id: str, session: AsyncSession = Depends(get_db_session)):
    query = (
        select(Incident)
        .where(Incident.id == incident_id)
        .options(selectinload(Incident.events), selectinload(Incident.ai_analysis))
    )
    result = await session.execute(query)
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    # On-demand trigger: if this incident doesn't have an AI analysis yet, trigger it
    # in the background. The frontend's 5s auto-polling will load it on the next tick.
    if not incident.ai_analysis:
        try:
            import uuid
            from correlation.engine import _trigger_ai_analysis
            asyncio.create_task(
                _trigger_ai_analysis(uuid.UUID(incident_id), incident.service, incident.severity),
                name=f"ai-ondemand-{incident_id}"
            )
            logger.info("On-demand AI analysis triggered for %s", incident_id)
        except Exception as e:
            logger.error("Failed to trigger on-demand AI analysis for %s: %s", incident_id, e)
            
    return incident
