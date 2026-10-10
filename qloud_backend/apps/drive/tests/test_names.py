import pytest
from django.core.exceptions import ValidationError

from apps.drive.names import normalize_name


@pytest.mark.parametrize(
    ("raw", "name"),
    [("  Báo cáo.pdf ", "Báo cáo.pdf"), ("a", "a"), ("x" * 255, "x" * 255), ("..a", "..a")],
)
def test_normalize_name_trims_valid_names(raw, name):
    assert normalize_name(raw) == name


@pytest.mark.parametrize(
    "raw", ["", "   ", ".", "..", " .. ", "a/b", "tab\there", "nul\x00", "del\x7f", "x" * 256]
)
def test_normalize_name_rejects_invalid_names(raw):
    with pytest.raises(ValidationError):
        normalize_name(raw)
