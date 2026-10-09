import os

from celery import Celery

# Importing `config` loads this module first, so its default wins over wsgi/asgi.
# Keep it on prod; only manage.py defaults to dev.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

app = Celery("qloud")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
