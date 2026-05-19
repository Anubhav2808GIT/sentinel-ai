from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request, Response
import time

# Global Metrics Definitions
EVENTS_INGESTED = Counter('events_ingested_total', 'Total number of events ingested', ['service', 'level'])
INCIDENTS_CREATED = Counter('incidents_created_total', 'Total number of new incidents created', ['service', 'severity'])
AI_ANALYSIS_REQUESTS = Counter('ai_analysis_requests_total', 'Total AI analysis requests')
AI_ANALYSIS_FAILURES = Counter('ai_analysis_failures_total', 'Total AI analysis failures')
WS_CONNECTIONS = Counter('websocket_connections_total', 'Total active websocket connections')

PROCESSING_LATENCY = Histogram('processing_latency_seconds', 'Latency of event correlation processing', ['service'])
AI_RESPONSE_LATENCY = Histogram('ai_response_latency_seconds', 'Latency of Ollama LLM responses')

async def metrics_endpoint(request: Request):
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

async def metrics_middleware(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    # Simple middleware for generic request latency if needed, 
    # but we will manually track specific latencies using the Histograms above.
    return response
