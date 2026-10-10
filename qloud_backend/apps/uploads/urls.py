from django.urls import path

from .views import UploadCompleteView, UploadDetailView, UploadListCreateView, UploadPartsView

urlpatterns = [
    path("uploads", UploadListCreateView.as_view(), name="uploads"),
    path("uploads/<uuid:upload_id>", UploadDetailView.as_view(), name="upload-detail"),
    path("uploads/<uuid:upload_id>/parts", UploadPartsView.as_view(), name="upload-parts"),
    path("uploads/<uuid:upload_id>/complete", UploadCompleteView.as_view(), name="upload-complete"),
]
