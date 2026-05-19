FROM python:3.11-slim

WORKDIR /app

COPY services/ingestion-service/requirements.txt ./services/ingestion-service/
RUN pip install --no-cache-dir -r ./services/ingestion-service/requirements.txt

# Copy shared utilities
COPY shared/ ./shared/

# Copy service code
COPY services/ingestion-service/ ./services/ingestion-service/

ENV PYTHONPATH=/app
WORKDIR /app/services/ingestion-service

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
