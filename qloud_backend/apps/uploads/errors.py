from rest_framework import status

from apps.core.errors import AppError


class EmailNotVerified(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "email_not_verified"
    default_detail = "Verify your email address before uploading."


class FileTooLarge(AppError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_code = "file_too_large"
    default_detail = "The file is larger than your plan allows."


class QuotaExceeded(AppError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_code = "quota_exceeded"
    default_detail = "Not enough storage left for this file."


class UploadIncomplete(AppError):
    default_code = "upload_incomplete"
    default_detail = "Some parts are missing or the size does not match."


class UploadExpired(AppError):
    status_code = status.HTTP_410_GONE
    default_code = "upload_expired"
    default_detail = "This upload has expired; start it again."


class UploadClosed(AppError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "upload_closed"
    default_detail = "This upload was already completed or cancelled."


class TargetUnavailable(AppError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "target_unavailable"
    default_detail = "The destination file or folder is no longer available."


class StorageUnavailable(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "storage_unavailable"
    default_detail = "File storage is unavailable; try again shortly."
