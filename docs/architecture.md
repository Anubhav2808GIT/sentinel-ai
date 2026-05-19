# SentinelAI Architecture & Design Rationale

## System Overview
SentinelAI is a production-grade, AI-native incident intelligence platform designed to provide real-time observability, automated root cause analysis (RCA), and incident mitigation strategies. 

The system leverages an event-driven architecture, robust microservices, and AI models to reduce Mean Time to Resolution (MTTR) for infrastructure failures.

## Architectural Components

1. **Frontend (Next.js & React 18)**:
   - Uses Server-Side Rendering (SSR) for fast initial loads and Client-Side Rendering for dynamic, real-time dashboards.
   - Designed with an "Elite Command Center" aesthetic (Tailwind, Framer Motion) mimicking platforms like Datadog and Linear.
   - WebSockets for real-time telemetry rendering and incident feed updates.

2. **WebSocket Gateway (FastAPI)**:
   - Maintains persistent connections to clients.
   - Subscribes to Redis Streams to push correlation events and incident updates synchronously to clients without overloading the backend REST API.

3. **Event Ingestion Service (FastAPI)**:
   - Entry point for all system logs, metrics, and alerts.
   - Pushes raw data to Redis Streams (`telemetry_stream`) for decoupling and horizontal scalability.

4. **Event Processor / Correlation Engine (Python)**:
   - Consumes data from Redis Streams.
   - Identifies anomalies, correlates events into active incidents using sliding windows, and delegates complex incidents to the AI Analysis Service.
   - Stores durable incident state into PostgreSQL.

5. **AI Analysis Service (FastAPI + Ollama)**:
   - Submits clustered incident telemetry to a locally-hosted LLM (Ollama) to extract probable root causes, blast radiuses, and remediation steps.
   - Integrates memory-graph abstractions to support future semantic similarity searches for recurring incidents.

6. **Persistence Layer**:
   - **PostgreSQL**: Source of truth for incidents, historical event data, and AI RCA reports. Relational design ensures ACID compliance.
   - **Redis**: High-throughput message broker and volatile caching layer.
   - **Prometheus/Grafana**: Tracks core system metrics, ensuring that SentinelAI monitors itself.

## Design Rationale & Scalability Decisions

- **Event-Driven via Redis Streams**: Standard REST calls between microservices for data processing introduce latency and tight coupling. Redis Streams acts as an asynchronous buffer, allowing the Event Processor to consume events at its own pace without blocking the Ingestion Service.
- **Repository Pattern**: Data access is abstracted behind Repositories (e.g., `IncidentRepository`), ensuring the business logic isn't tied directly to SQLAlchemy/Postgres. This makes testing and future database migrations trivial.
- **AI Asynchrony**: LLM generations take time. The AI Analysis engine uses background tasks to compute RCA, pushing the final analysis through Redis to the Gateway, keeping the UX non-blocking.
- **Future Readiness**: Interface boundaries for Vector DB integration, K8s metric streaming, and Automated Remediation exist, demonstrating foresight into Day 2 operations without over-engineering Day 1.

## Operational Considerations

- **Graceful Degradation**: If the AI engine is down, the core observability dashboard and correlation engine continue to function normally.
- **Demo Mode Orchestration**: A frontend-driven simulation engine exists to orchestrate cascading scenarios (e.g., Cache Collapse) for high-impact demonstrations, bypassing the need for complex, manual backend sabotage during showcases.
