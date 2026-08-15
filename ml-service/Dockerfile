# Pinned by digest alone, not `python:3.11-slim@sha256:...` (docker:S8431). Specifying both
# is not belt-and-braces: Docker resolves the reference by digest and never checks the tag
# against it, so the tag is decorative and can drift into an outright lie about which image
# this is. The digest is the half that carries the guarantee, so the digest is the half kept.
#
# This digest was pinned from python:3.11-slim, and the image must stay a Python 3.11 base:
# ml-service is analysed as `sonar.python.version=3.11`, CI installs and tests on 3.11, and
# requirements*.txt is compiled against it. Re-pin deliberately when moving Python version,
# and update this comment in the same change - it is the only remaining record of what the
# digest is supposed to be.
FROM python@sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff

WORKDIR /app

# Copy requirements and install dependencies as root (before user switch)
COPY requirements-runtime.txt .
RUN pip install --no-cache-dir --require-hashes --only-binary :all: -r requirements-runtime.txt && \
    pip uninstall --yes setuptools wheel && \
    chmod 444 requirements-runtime.txt

# Copy application code as root. Model artifacts are mounted or copied by the
# deployment pipeline only after their manifest checksum is configured.
COPY app.py models.py bedrock_client.py forecast_service.py ./
COPY crewsafe_ml ./crewsafe_ml
COPY agent ./agent

# Create non-root user and set restrictive permissions on all files
RUN useradd -m -u 1000 appuser && \
    chmod 444 app.py models.py bedrock_client.py forecast_service.py && \
    chmod -R a-w crewsafe_ml agent && \
    chown -R appuser:appuser /app

# Run both the application and its health check without root privileges.
USER appuser

# The standard-library probe avoids adding curl only for health checks.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
