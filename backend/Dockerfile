FROM python:3.12-slim

# System deps: psycopg2-binary ships wheels so no libpq needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source.
COPY app ./app
COPY main.py ./
COPY migrations ./migrations
COPY seed_workouts.py ./
COPY scripts ./scripts
# seed_data/ is optional — the fresh-env fallback path kicks in if absent.
COPY seed_data ./seed_data

# Build-time metadata baked into the image so /health can echo back
# "which commit is actually running." Mirrors the frontend pattern in
# mobile/scripts/build-web.sh — both surfaces feed the Settings-tab
# build-stamp diagnostic. Defaults to "dev" when the build arg isn't
# passed (local `docker build` without --build-arg).
ARG BUILD_SHA=dev
ARG BUILD_TIME=
ENV TASKAPP_BUILD_SHA=${BUILD_SHA}
ENV TASKAPP_BUILD_TIME=${BUILD_TIME}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

EXPOSE 8080

# tini reaps zombies so SIGTERM shutdowns are clean.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
