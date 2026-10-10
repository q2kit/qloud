from rest_framework import status

from apps.core.errors import AppError


class NameConflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "name_conflict"
    default_detail = "An item with this name already exists in the folder."


class InvalidTarget(AppError):
    default_code = "invalid_target"
    default_detail = "The target must be a folder."


class InvalidMove(AppError):
    default_code = "invalid_move"
    default_detail = "A folder cannot be moved into itself or one of its subfolders."


class RootFolder(AppError):
    default_code = "root_folder"
    default_detail = "The root folder cannot be renamed, moved or deleted."


class NotAFile(AppError):
    default_code = "not_a_file"
    default_detail = "Only files can be downloaded."
