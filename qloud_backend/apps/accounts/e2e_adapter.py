"""Browser isolation for report rate-limit E2E tests; never selected in production."""

from django.http import HttpRequest

from .adapter import AccountAdapter


class E2EAccountAdapter(AccountAdapter):
    def get_client_ip(self, request: HttpRequest) -> str:
        return request.headers.get("X-Qloud-E2E-IP") or super().get_client_ip(request)
