from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class AccountsConfig(AppConfig):
    # allauth already shows an "Accounts" section (email addresses) in the admin.
    verbose_name = _("Users and plans")
    name = "apps.accounts"
