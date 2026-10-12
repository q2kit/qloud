"""Exercise the real API with a rolled-back, 100k-node owned/shared corpus."""

import json
import math
import time
import uuid
from typing import Any

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import User
from apps.drive.models import Node
from apps.search.views import SearchView
from apps.sharing.models import Share


class Command(BaseCommand):
    help = "Benchmark search API; generated corpus is always rolled back."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--samples", type=int, default=30)

    @transaction.atomic
    def handle(self, *args: Any, **options: Any) -> None:
        suffix = uuid.uuid4().hex
        user = User.objects.create_user(f"benchmark-{suffix}@example.com")
        other = User.objects.create_user(f"shared-{suffix}@example.com")
        folder = Node.objects.create(owner=other, parent=other.root_folder, name="Shared corpus")
        Share.objects.create(node=folder, grantee=user, created_by=other, role="editor")
        for start in range(0, 99_999, 5000):
            Node.objects.bulk_create(
                [
                    Node(
                        owner=user if i < 49_999 else other,
                        parent_id=user.root_folder_id if i < 49_999 else folder.pk,
                        kind="file",
                        mime_type="text/plain",
                        name=f"{'Báo cáo' if i % 100 == 0 else 'Record'} {i:06}.txt",
                    )
                    for i in range(start, min(start + 5000, 99_999))
                ]
            )
        with connection.cursor() as cursor:
            cursor.execute("ANALYZE drive_node")
            cursor.execute("SELECT version()")
            version = cursor.fetchone()[0]
        factory = APIRequestFactory()
        result = {
            "nodes": 100_000,
            "samples": options["samples"],
            "database": version,
            "queries": [],
        }
        for params in [
            {"q": "bao cao"},
            {"q": "record"},
            {"q": "r"},
            {"q": "missingXYZ"},
            {"q": "bao cao", "owner": "others", "type": "document"},
        ]:
            timings = []
            for _ in range(options["samples"] + 1):
                request = factory.get("/api/v1/search", params, HTTP_HOST="localhost")
                force_authenticate(request, user)
                started = time.perf_counter()
                response = SearchView.as_view()(request)
                response.render()
                if response.status_code != 200:
                    raise RuntimeError(response.data)
                timings.append((time.perf_counter() - started) * 1000)
            timings = sorted(timings[1:])
            result["queries"].append(
                {"params": params, "p95_ms": round(timings[math.ceil(len(timings) * 0.95) - 1], 2)}
            )
        transaction.set_rollback(True)
        self.stdout.write(json.dumps(result, indent=2, ensure_ascii=False))
