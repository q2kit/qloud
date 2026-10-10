from django.urls import path

from .views import (
    FolderCreateView,
    NodeChildrenView,
    NodeDetailView,
    NodeDownloadView,
    NodeMoveView,
    NodePreviewView,
    RecentView,
)

urlpatterns = [
    path("recent", RecentView.as_view(), name="recent"),
    path("nodes/move", NodeMoveView.as_view(), name="nodes-move"),
    path("nodes/<uuid:node_id>", NodeDetailView.as_view(), name="node-detail"),
    path("nodes/<uuid:node_id>/children", NodeChildrenView.as_view(), name="node-children"),
    path("nodes/<uuid:node_id>/download", NodeDownloadView.as_view(), name="node-download"),
    path("nodes/<uuid:node_id>/preview", NodePreviewView.as_view(), name="node-preview"),
    path("folders", FolderCreateView.as_view(), name="folders"),
]
