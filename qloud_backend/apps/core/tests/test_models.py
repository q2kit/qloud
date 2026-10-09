import uuid

from apps.core.models import BaseModel


def test_base_model_primary_key_is_uuid7():
    field = BaseModel._meta.get_field("id")

    assert field.default is uuid.uuid7
    assert field.default().version == 7
