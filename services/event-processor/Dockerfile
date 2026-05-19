FROM python:3.11-slim

WORKDIR /app

COPY services/event-processor/requirements.txt ./services/event-processor/
RUN pip install --no-cache-dir -r ./services/event-processor/requirements.txt

# Copy shared utilities
COPY shared/ ./shared/

# Copy service code
COPY services/event-processor/ ./services/event-processor/

ENV PYTHONPATH=/app
WORKDIR /app/services/event-processor

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
