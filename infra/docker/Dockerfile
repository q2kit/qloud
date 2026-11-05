# syntax=docker/dockerfile:1
# Production images (qloud_docs/deploy.md). Build from the repository root:
#   docker build -f infra/docker/Dockerfile --target backend -t qloud-backend .
#   docker build -f infra/docker/Dockerfile --target web -t qloud-web .
# CI builds and pushes both to GHCR (.github/workflows/images.yml).

ARG PYTHON_IMAGE=python:3.14.10-slim-trixie
ARG NODE_IMAGE=node:24.22.2-slim
ARG NGINX_IMAGE=nginx:1.30.6-alpine
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.7

FROM ${UV_IMAGE} AS uv

# --- LGPL-only FFmpeg for video thumbnails (M3-04) ---
# Built at its final prefix: the binaries find their shared libraries through RPATH.
FROM ${PYTHON_IMAGE} AS ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev make zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/build_ffmpeg.py /build/build_ffmpeg.py
RUN python3 /build/build_ffmpeg.py --prefix /opt/qloud-ffmpeg

# --- Python dependencies from uv.lock, without dev tools ---
FROM ${PYTHON_IMAGE} AS backend-deps
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
COPY qloud_backend/pyproject.toml qloud_backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

# --- Django admin and DRF assets, served by nginx under /static/ ---
FROM backend-deps AS static
COPY qloud_backend/ ./
# Test settings only need defaults here: collectstatic reads no database and no secret.
RUN DJANGO_SETTINGS_MODULE=config.settings.test /opt/venv/bin/python manage.py collectstatic --noinput

# --- api, worker, beat and migrate all run this image ---
FROM ${PYTHON_IMAGE} AS backend
RUN groupadd --system qloud && useradd --system --gid qloud --no-create-home --home-dir /app qloud
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod \
    THUMBNAIL_FFMPEG=/opt/qloud-ffmpeg/bin/ffmpeg \
    THUMBNAIL_FFPROBE=/opt/qloud-ffmpeg/bin/ffprobe
# Keep the whole prefix: share/qloud-ffmpeg holds the LGPL source, licence and build flags.
COPY --from=ffmpeg /opt/qloud-ffmpeg /opt/qloud-ffmpeg
COPY --from=backend-deps /opt/venv /opt/venv
WORKDIR /app
COPY qloud_backend/ ./
USER qloud
EXPOSE 8000
CMD ["gunicorn", "config.wsgi", "--config", "python:config.gunicorn"]

# --- Frontend build ---
FROM ${NODE_IMAGE} AS frontend
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY qloud_frontend/package.json qloud_frontend/pnpm-lock.yaml qloud_frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY qloud_frontend/ ./
RUN pnpm build

# --- nginx: plain HTTP behind the host's nginx; SPA, /static/, proxy to api (ADR-0014) ---
FROM ${NGINX_IMAGE} AS web
COPY infra/nginx/qloud.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/proxy.conf infra/nginx/security-headers.conf /etc/nginx/qloud/
COPY --from=frontend /app/dist /usr/share/nginx/html
COPY --from=static /app/staticfiles /usr/share/nginx/static
EXPOSE 80
