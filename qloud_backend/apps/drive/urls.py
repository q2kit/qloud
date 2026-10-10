from django.urls import path

from .views import FolderCreateView, NodeChildrenView, NodeDetailView, NodeMoveView

urlpatterns = [
    path("nodes/move", NodeMoveView.as_view(), name="nodes-move"),
    path("nodes/<uuid:node_id>", NodeDetailView.as_view(), name="node-detail"),
    path("nodes/<uuid:node_id>/children", NodeChildrenView.as_view(), name="node-children"),
    path("folders", FolderCreateView.as_view(), name="folders"),
]
