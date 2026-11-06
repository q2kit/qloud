"""gunicorn settings for the production api container (qloud_docs/deploy.md)."""

import os

bind = "0.0.0.0:8000"
worker_class = "gthread"
workers = int(os.environ.get("GUNICORN_WORKERS", "3"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
# Below Cloudflare's 100 s proxy timeout: a stuck request fails here, not at the edge.
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "60"))
graceful_timeout = 30
# nginx keeps upstream connections open (keepalive), so outlive its idle timeout.
keepalive = 75
accesslog = "-"
errorlog = "-"
