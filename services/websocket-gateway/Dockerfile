FROM python:3.11-slim

WORKDIR /app

COPY services/websocket-gateway/requirements.txt ./services/websocket-gateway/
RUN pip install --no-cache-dir -r ./services/websocket-gateway/requirements.txt

# Copy shared utilities
COPY shared/ ./shared/

# Copy service code
COPY services/websocket-gateway/ ./services/websocket-gateway/

ENV PYTHONPATH=/app
WORKDIR /app/services/websocket-gateway

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
