from django.urls import path

from .views import NodeSharesView, ShareDetailView, SharedWithMeView

urlpatterns = [
    path("nodes/<uuid:node_id>/shares", NodeSharesView.as_view(), name="node-shares"),
    path("shares/<uuid:share_id>", ShareDetailView.as_view(), name="share-detail"),
    path("shared-with-me", SharedWithMeView.as_view(), name="shared-with-me"),
]
