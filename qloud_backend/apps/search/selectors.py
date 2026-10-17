"""Ranked name search over the common permission scope."""

import datetime

from django.contrib.postgres.search import TrigramSimilarity
from django.db import connection
from django.db.models import (
    Case,
    CharField,
    Exists,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Value,
    When,
)
from django.db.models.functions import Cast

from apps.accounts.models import User
from apps.drive.mime import group_filters
from apps.drive.models import Node
from apps.sharing.permissions import Role, nodes_for

TYPE_FILTERS = {
    "folder": Q(kind=Node.Kind.FOLDER),
    **{group: Q(kind=Node.Kind.FILE) & condition for group, condition in group_filters().items()},
}
SEARCH_TYPES = tuple(TYPE_FILTERS)


def normalized_query(query: str) -> str:
    # The caller keeps the transaction open through evaluation: threshold is local,
    # never leaked to a pooled connection or affected by the deployment's default.
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT lower(unaccent(normalize(%s, NFC)) COLLATE "C"), '
            "set_config('pg_trgm.similarity_threshold', '0.3', true)",
            [query],
        )
        row = cursor.fetchone()
    return str(row[0])


def search_nodes(
    user: User,
    query: str,
    *,
    node_type: str = "",
    owner: str = "",
    modified_after: datetime.datetime | None = None,
) -> QuerySet[Node]:
    matches = Q(search_name__contains=query)
    if len(query) >= 3:
        matches |= Q(search_name__trigram_similar=query)
    rows = nodes_for(user).exclude(parent_id=None).filter(matches).select_related("owner")
    if node_type:
        rows = rows.filter(TYPE_FILTERS[node_type])
    if owner == "me":
        rows = rows.filter(owner=user)
    elif owner == "others":
        rows = rows.exclude(owner=user)
    if modified_after is not None:
        rows = rows.filter(updated_at__gte=modified_after)
    editable = nodes_for(user, Role.EDITOR).filter(pk=OuterRef("pk"))
    return rows.annotate(
        match_rank=Case(
            When(search_name=query, then=Value(0)),
            When(search_name__startswith=query, then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
        # Quantize in SQL, so ordering and cursor comparisons use identical values.
        similarity_rank=Cast(TrigramSimilarity("search_name", query) * 1_000_000, IntegerField()),
        effective_role=Case(
            When(owner=user, then=Value("owner")),
            When(Exists(editable), then=Value("editor")),
            default=Value("viewer"),
            output_field=CharField(),
        ),
    )
