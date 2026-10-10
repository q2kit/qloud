from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.accounts.auth_views import EmailAwareSignupView, RememberLoginView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("apps.core.urls")),
    # These must precede the allauth include so they replace the stock headless views.
    path(
        "api/auth/browser/v1/auth/login",
        RememberLoginView.as_api_view(client="browser"),
        name="auth-login",
    ),
    path(
        "api/auth/browser/v1/auth/signup",
        EmailAwareSignupView.as_api_view(client="browser"),
        name="auth-signup",
    ),
    path("api/auth/", include("allauth.headless.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]
