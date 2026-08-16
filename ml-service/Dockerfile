FROM python:3.11-slim@sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff

WORKDIR /app

# Copy requirements and install dependencies as root (before user switch)
COPY requirements-runtime.txt .
RUN pip install --no-cache-dir --require-hashes --only-binary :all: -r requirements-runtime.txt && \
    pip uninstall --yes setuptools wheel && \
    chmod 444 requirements-runtime.txt

# Copy application code and the reviewed staging-demo bundle as root. The
# runtime still refuses the bundle unless ECS supplies its exact manifest
# checksum, so baking it into the image does not activate it by itself.
COPY app.py models.py bedrock_client.py forecast_service.py ./
COPY crewsafe_ml ./crewsafe_ml
COPY agent ./agent
COPY model-bundle/staging-demo-v1 ./model-bundle/staging-demo-v1

# Create non-root user and set restrictive permissions on all files
RUN useradd -m -u 1000 appuser && \
    chmod 444 app.py models.py bedrock_client.py forecast_service.py && \
    chmod -R a-w crewsafe_ml agent model-bundle && \
    chown -R appuser:appuser /app

# Run both the application and its health check without root privileges.
USER appuser

# The standard-library probe avoids adding curl only for health checks.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
