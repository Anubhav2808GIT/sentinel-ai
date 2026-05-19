FROM python:3.11-slim

WORKDIR /app

COPY services/ai-analysis/requirements.txt ./services/ai-analysis/
RUN pip install --no-cache-dir -r ./services/ai-analysis/requirements.txt

# Copy shared utilities
COPY shared/ ./shared/

# Copy service code
COPY services/ai-analysis/ ./services/ai-analysis/

ENV PYTHONPATH=/app
WORKDIR /app/services/ai-analysis

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
