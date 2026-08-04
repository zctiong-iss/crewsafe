FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install dependencies as root (before user switch)
COPY requirements.txt .
RUN pip install --no-cache-dir --require-hashes --only-binary :all: -r requirements.txt && \
    chmod 444 requirements.txt

# Copy application code as root
COPY app.py models.py bedrock_client.py forecast_service.py test_forecast.py ./

# Create non-root user and set restrictive permissions on all files
RUN useradd -m -u 1000 appuser && \
    chmod 444 app.py models.py bedrock_client.py forecast_service.py test_forecast.py && \
    chown -R appuser:appuser /app

# Health check (runs as root via Docker healthcheck mechanism)
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Switch to non-root user only for runtime
USER appuser

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
