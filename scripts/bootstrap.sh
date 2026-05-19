#!/bin/bash
set -e

echo "🚀 Bootstrapping SentinelAI Infrastructure..."

# 1. Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "❌ Docker could not be found. Please install Docker."
    exit 1
fi

# 2. Setup Environment Variables
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

# 3. Build and Start Services
echo "Building and starting Docker containers..."
docker compose up -d --build

echo "Waiting for services to initialize..."
sleep 10

# 4. Run verification
echo "Running stack verification..."
python3 scripts/verify_stack.py

echo "✅ Bootstrap Complete!"
echo "Dashboard: http://localhost:3000"
echo "Grafana: http://localhost:3001"
echo "To simulate live traffic, run: python scripts/generate_logs.py"
