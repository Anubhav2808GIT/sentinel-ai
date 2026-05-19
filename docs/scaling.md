# SentinelAI Scaling Strategy

## Horizon Scaling Model

SentinelAI is designed with an event-driven architecture utilizing **Redis Streams** to decouple ingestion from processing, allowing for independent scaling of each tier.

### 1. Ingestion Layer (Stateless)
The `ingestion-service` is fully stateless. It merely validates incoming POST requests and blindly appends them to Redis Streams using `XADD`.
- **Scaling Method**: Horizontal scaling via Kubernetes Deployments or AWS Auto Scaling Groups behind a standard Layer 7 load balancer.
- **Bottleneck**: Network I/O and Redis write throughput.

### 2. Message Broker (Redis Streams)
Redis serves as the buffer absorbing high-throughput telemetry bursts.
- **Scaling Method**: Redis Cluster. Streams can be sharded across multiple primary nodes if throughput exceeds a single node's memory/CPU limits (typically > 100k ops/sec).
- **Resilience**: Redis Streams offer consumer groups (`XGROUP`), ensuring that if a consumer crashes, pending messages are not lost and can be claimed by another consumer.

### 3. Event Processor (Stateful Consumers)
The `event-processor` consumes from Redis Streams and performs stateful correlation (e.g., matching a database timeout to a gateway 502).
- **Scaling Method**: Horizontal scaling using Redis Consumer Groups. Multiple `event-processor` replicas can join the same group, and Redis will round-robin messages to available workers.
- **Concurrency**: Fully asynchronous using `asyncio`, allowing a single process to handle thousands of concurrent I/O waits (DB writes, AI calls).

### 4. AI Analysis (Compute Bound)
The `ai-analysis` service delegates LLM inference. This is the most computationally expensive part of the stack.
- **Scaling Method**: Queue-based worker pools. The Event Processor pushes "correlation complete" events back to Redis, which the AI Analysis service consumes at its own pace.
- **Model Distribution**: Switch from local Ollama instances to managed inference endpoints (e.g., vLLM clusters, AWS Bedrock, or OpenAI API) to offload GPU constraints.

### 5. WebSocket Gateway (Connection Bound)
Maintains persistent connections to client dashboards.
- **Scaling Method**: Horizontal scaling using a Redis Pub/Sub backplane. The `websocket-gateway` nodes subscribe to a central Redis channel. When an incident updates, the payload is published to Redis, and all gateway nodes broadcast it to their respective connected clients. This allows seamless horizontal scaling behind a load balancer that supports WebSocket sticky sessions.
