# Nightjar Telegram scheduler — always-on reminder server.
# Build:  docker build -t nightjar-telegram-scheduler .
# Run:    docker run -d --env-file .env -p 8080:8080 -v nightjar_sched:/data nightjar-telegram-scheduler
#
# The named volume mounted at /data (DATA_DIR) holds scheduler.db, so reminders survive
# container restarts/upgrades. Install a provider extra by editing the pip line below.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data

WORKDIR /app

# Install deps first for layer caching. Add ".[anthropic]" or ".[openai]" to pull a real provider.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Persistent storage for the SQLite jobstore + app tables.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

# HTTP health check (works even in mock mode; no bot token required).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health').status==200 else 1)"

CMD ["nightjar-telegram-scheduler"]
