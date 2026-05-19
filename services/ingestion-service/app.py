from fastapi import FastAPI
from routes import ingest
from shared.metrics.prometheus import metrics_endpoint

app = FastAPI(title="SentinelAI Ingestion Service")

@app.get("/")
async def root():
    return {
        "service": "ingestion-service",
        "status": "running"
    }

app.get("/metrics")(metrics_endpoint)

app.include_router(ingest.router)