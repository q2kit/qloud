"""Server-side verification of Cloudflare Turnstile tokens."""

import json
import logging
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

logger = logging.getLogger(__name__)


def turnstile_enabled() -> bool:
    return bool(settings.TURNSTILE_SECRET_KEY)


def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
    """Return whether Cloudflare accepts the token.

    Verification is skipped when no secret key is configured (production refuses
    to start without one). Network failures count as a failed check: a bot must
    not get through just because Cloudflare is unreachable.
    """
    if not turnstile_enabled():
        return True
    if not token:
        return False
    data = {"secret": settings.TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    request = Request(VERIFY_URL, data=urlencode(data).encode())
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 (fixed https URL)
            result = json.load(response)
    except URLError, TimeoutError, ValueError:
        logger.warning("Turnstile verification is unavailable", exc_info=True)
        return False
    return bool(result.get("success"))
