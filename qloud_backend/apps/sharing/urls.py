from django.urls import path

from .link_views import (
    LinkDetailView,
    NodeLinksView,
    PublicChildrenView,
    PublicDownloadView,
    PublicLinkView,
    PublicPreviewView,
)
from .views import NodeSharesView, ShareDetailView, SharedWithMeView

urlpatterns = [
    path("nodes/<uuid:node_id>/links", NodeLinksView.as_view(), name="node-links"),
    path("links/<uuid:link_id>", LinkDetailView.as_view(), name="link-detail"),
    path("public/links/<str:token>", PublicLinkView.as_view(), name="public-link"),
    path("public/links/<str:token>/children", PublicChildrenView.as_view(), name="public-children"),
    path("public/links/<str:token>/download", PublicDownloadView.as_view(), name="public-download"),
    path("public/links/<str:token>/preview", PublicPreviewView.as_view(), name="public-preview"),
    path("nodes/<uuid:node_id>/shares", NodeSharesView.as_view(), name="node-shares"),
    path("shares/<uuid:share_id>", ShareDetailView.as_view(), name="share-detail"),
    path("shared-with-me", SharedWithMeView.as_view(), name="shared-with-me"),
]
