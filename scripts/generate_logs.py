#!/usr/bin/env python3
import asyncio
import httpx
import random
import time
from datetime import datetime

import os

INGESTION_URL = os.getenv("INGESTION_URL", "http://localhost:8000/logs")

SERVICES = [
    "payment-api", 
    "auth-service", 
    "notification-service", 
    "analytics-worker", 
    "gateway-api", 
    "database-cluster"
]

NORMAL_TEMPLATES = [
    "Successfully processed request {req_id}",
    "User {user_id} authenticated successfully",
    "Health check passed for component {component}",
    "Queue depth is currently at {depth} messages",
    "Cache hit ratio: {ratio}%",
    "Job {req_id} completed in {depth}ms",
    "Payload validation passed for endpoint /api/v1/resource",
    "Database query executed in {depth}ms",
    "Worker thread {user_id} idle",
    "Upstream connection to {component} stable"
]

SCENARIOS = [
    {
        "name": "Database Timeout Spikes",
        "events": [
            {"service": "database-cluster", "level": "CRITICAL", "message": "Postgres database timeout spikes detected in pool. Connections maxed out {req_id}."},
            {"service": "database-cluster", "level": "ERROR", "message": "Postgres database timeout spikes detected in pool. Rejecting new connections {req_id}."},
            {"service": "payment-api", "level": "ERROR", "message": "Database timeout spikes from upstream database-cluster. Query failed for {tx_id}."},
            {"service": "payment-api", "level": "ERROR", "message": "Database timeout spikes from upstream database-cluster. Transaction aborted for {tx_id}."},
            {"service": "gateway-api", "level": "ERROR", "message": "502 Bad Gateway: Upstream payment-api database timeout. Request {req_id} failed."},
            {"service": "gateway-api", "level": "ERROR", "message": "502 Bad Gateway: Upstream payment-api database timeout. Connection {req_id} dropped."}
        ],
        "recovery": [
            {"service": "database-cluster", "level": "INFO", "message": "Postgres database timeout spikes resolved. Connections scaling up."},
            {"service": "payment-api", "level": "INFO", "message": "Database timeout spikes resolved. Connection restored."},
            {"service": "gateway-api", "level": "INFO", "message": "Upstream payment-api database timeout resolved. Traffic recovering."}
        ]
    },
    {
        "name": "Redis Connection Pool Exhaustion",
        "events": [
            {"service": "auth-service", "level": "CRITICAL", "message": "Redis connection pool exhaustion detected. Unable to fetch sessions for {user_id}."},
            {"service": "auth-service", "level": "ERROR", "message": "Redis connection pool exhaustion detected. Session validation failed for {user_id}."},
            {"service": "gateway-api", "level": "ERROR", "message": "502 Upstream failures: auth-service unreachable. Dropping request {req_id}."},
            {"service": "gateway-api", "level": "ERROR", "message": "502 Upstream failures: auth-service unreachable. Timeout on request {req_id}."}
        ],
        "recovery": [
            {"service": "auth-service", "level": "INFO", "message": "Redis connection pool exhaustion resolved. Sessions active."},
            {"service": "gateway-api", "level": "INFO", "message": "Upstream failures resolved. auth-service healthy."}
        ]
    },
    {
        "name": "JWT Validation Failures",
        "events": [
            {"service": "auth-service", "level": "CRITICAL", "message": "JWT validation failures detected. Key rotation mismatch for user {user_id}."},
            {"service": "auth-service", "level": "ERROR", "message": "JWT validation failures detected. Signature invalid for user {user_id}."},
            {"service": "gateway-api", "level": "ERROR", "message": "401 Unauthorized spike. Upstream JWT validation failures for request {req_id}."},
            {"service": "gateway-api", "level": "ERROR", "message": "401 Unauthorized spike. Upstream JWT validation failures dropping request {req_id}."}
        ],
        "recovery": [
            {"service": "auth-service", "level": "INFO", "message": "JWT validation failures resolved. Keys synchronized."},
            {"service": "gateway-api", "level": "INFO", "message": "401 Unauthorized spike resolved. Traffic resuming."}
        ]
    },
    {
        "name": "Postgres Replication Lag",
        "events": [
            {"service": "database-cluster", "level": "CRITICAL", "message": "Postgres replication lag exceeds threshold. Stale reads on replica-{ratio}."},
            {"service": "database-cluster", "level": "ERROR", "message": "Postgres replication lag exceeds threshold. Sync delayed on replica-{ratio}."},
            {"service": "analytics-worker", "level": "ERROR", "message": "Data skew detected due to Postgres replication lag for {req_id}."},
            {"service": "analytics-worker", "level": "ERROR", "message": "Data skew detected due to Postgres replication lag aborting {req_id}."}
        ],
        "recovery": [
            {"service": "database-cluster", "level": "INFO", "message": "Postgres replication lag recovered. Sync complete."},
            {"service": "analytics-worker", "level": "INFO", "message": "Data skew resolved. Batch jobs resuming."}
        ]
    },
    {
        "name": "Kafka Consumer Lag Spikes",
        "events": [
            {"service": "notification-service", "level": "CRITICAL", "message": "Kafka consumer lag spikes on topic notifications. Lag: {depth}k."},
            {"service": "notification-service", "level": "ERROR", "message": "Kafka consumer lag spikes on topic notifications. Dropping {req_id}."},
            {"service": "analytics-worker", "level": "ERROR", "message": "Kafka consumer lag spikes affecting data ingestion rate {req_id}."},
            {"service": "analytics-worker", "level": "ERROR", "message": "Kafka consumer lag spikes affecting data ingestion batch {req_id}."}
        ],
        "recovery": [
            {"service": "notification-service", "level": "INFO", "message": "Kafka consumer lag spikes resolved. Caught up to head."},
            {"service": "analytics-worker", "level": "INFO", "message": "Kafka consumer lag spikes resolved. Ingestion nominal."}
        ]
    }
]

def format_msg(msg: str) -> str:
    return msg.format(
        req_id=f"req-{random.randint(10000, 99999)}",
        user_id=f"usr-{random.randint(100, 999)}",
        tx_id=f"tx-{random.randint(1000000, 9999999)}",
        component=random.choice(["redis", "postgres", "kafka", "elasticsearch"]),
        depth=random.randint(10, 100),
        ratio=random.randint(1, 5)
    )

async def send_event(client: httpx.AsyncClient, service: str, level: str, message: str):
    payload = {
        "service": service,
        "level": level,
        "message": format_msg(message)
    }
    try:
        await client.post(INGESTION_URL, json=payload, timeout=2.0)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {level:8} | {service:20} | {payload['message']}")
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR sending to {INGESTION_URL}: {e}")

async def simulate_normal_traffic(client: httpx.AsyncClient):
    """Generates continuous baseline background traffic."""
    while True:
        service = random.choice(SERVICES)
        level = random.choices(["INFO", "DEBUG", "WARN"], weights=[0.8, 0.15, 0.05])[0]
        msg = random.choice(NORMAL_TEMPLATES)
        
        await send_event(client, service, level, msg)
        await asyncio.sleep(random.uniform(0.1, 1.0))

async def trigger_cascading_incident(client: httpx.AsyncClient):
    """Simulates a complex outage involving multiple services failing together."""
    scenario = random.choice(SCENARIOS)
    
    print("\n" + "="*60)
    print(f"🚨 TRIGGERING CASCADING INCIDENT: {scenario['name'].upper()}")
    print("="*60 + "\n")
    
    # 1. Burst the initial errors to create correlation
    for _ in range(random.randint(4, 8)):
        event = random.choice(scenario['events'])
        await send_event(client, event['service'], event['level'], event['message'])
        await asyncio.sleep(random.uniform(0.05, 0.2))
        
    # 2. Sustain the outage for a few seconds
    for _ in range(random.randint(10, 15)):
        event = random.choice(scenario['events'])
        await send_event(client, event['service'], event['level'], event['message'])
        await asyncio.sleep(random.uniform(0.2, 0.8))
        
    print(f"\n🔄 RECOVERING INCIDENT: {scenario['name']}")
    # 3. Recover the services with INFO logs
    for event in scenario['recovery']:
        for _ in range(2):
            await send_event(client, event['service'], event['level'], event['message'])
            await asyncio.sleep(0.1)
        
    print("\n" + "="*60)
    print(f"✅ INCIDENT RESOLVED: {scenario['name']}")
    print("="*60 + "\n")

async def incident_loop(client: httpx.AsyncClient):
    """Triggers anomalies at configurable intervals."""
    # Wait initially before firing the first incident
    await asyncio.sleep(5)
    while True:
        await trigger_cascading_incident(client)
        # Wait between 15 to 30 seconds before the next incident to see active correlation easily
        await asyncio.sleep(random.randint(15, 30))

async def main():
    print(f"🚀 Starting SentinelAI Event Simulator targeting {INGESTION_URL}")
    print("Press Ctrl+C to stop.\n")
    
    async with httpx.AsyncClient() as client:
        # Run normal traffic and incident loops concurrently
        await asyncio.gather(
            simulate_normal_traffic(client),
            incident_loop(client)
        )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nSimulation stopped gracefully.")
