from django.urls import path

from .views import (
    FolderCreateView,
    NodeChildrenView,
    NodeDetailView,
    NodeDownloadView,
    NodeMoveView,
    NodePreviewView,
    NodeTrashView,
    RecentView,
    TrashDeleteView,
    TrashEmptyView,
    TrashListView,
    TrashRestoreView,
)

urlpatterns = [
    path("nodes/trash", NodeTrashView.as_view(), name="nodes-trash"),
    path("trash", TrashListView.as_view(), name="trash-list"),
    path("trash/restore", TrashRestoreView.as_view(), name="trash-restore"),
    path("trash/delete", TrashDeleteView.as_view(), name="trash-delete"),
    path("trash/empty", TrashEmptyView.as_view(), name="trash-empty"),
    path("recent", RecentView.as_view(), name="recent"),
    path("nodes/move", NodeMoveView.as_view(), name="nodes-move"),
    path("nodes/<uuid:node_id>", NodeDetailView.as_view(), name="node-detail"),
    path("nodes/<uuid:node_id>/children", NodeChildrenView.as_view(), name="node-children"),
    path("nodes/<uuid:node_id>/download", NodeDownloadView.as_view(), name="node-download"),
    path("nodes/<uuid:node_id>/preview", NodePreviewView.as_view(), name="node-preview"),
    path("folders", FolderCreateView.as_view(), name="folders"),
]
