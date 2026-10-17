from django.urls import path

from .views import NodeActivityView

urlpatterns = [
    path("nodes/<uuid:node_id>/activity", NodeActivityView.as_view(), name="node-activity"),
]
