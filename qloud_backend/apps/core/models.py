import uuid

from django.db import models


class BaseModel(models.Model):
    """UUIDv7 primary key (time-ordered, not guessable) plus audit timestamps."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
