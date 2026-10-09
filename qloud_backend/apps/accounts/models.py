from typing import Any, ClassVar

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils.crypto import salted_hmac
from django.utils.translation import gettext_lazy as _

from apps.core.models import BaseModel


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra: Any) -> User:
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra: Any) -> User:
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra: Any) -> User:
        extra["is_staff"] = True
        extra["is_superuser"] = True
        return self._create_user(email, password, **extra)


class Plan(BaseModel):
    code = models.SlugField(_("Code"), max_length=50, unique=True)
    name = models.CharField(_("Name"), max_length=100)
    quota_bytes = models.PositiveBigIntegerField(_("Storage quota (bytes)"))
    max_file_size_bytes = models.PositiveBigIntegerField(_("Maximum file size (bytes)"))
    max_versions_per_file = models.PositiveIntegerField(
        _("Maximum old versions per file"), default=100
    )
    version_retention_days = models.PositiveIntegerField(
        _("Version retention (days)"), null=True, blank=True, default=30
    )
    trash_retention_days = models.PositiveIntegerField(_("Trash retention (days)"), default=30)
    is_default_for_signup = models.BooleanField(_("Default for signup"), default=False)
    is_active = models.BooleanField(_("Active"), default=True)

    class Meta:
        verbose_name = _("Plan")
        verbose_name_plural = _("Plans")
        constraints = [
            models.UniqueConstraint(
                fields=["is_default_for_signup"],
                condition=Q(is_default_for_signup=True),
                name="plan_one_default",
            ),
            models.CheckConstraint(
                condition=Q(is_default_for_signup=False) | Q(is_active=True),
                name="plan_default_active",
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def clean(self) -> None:
        super().clean()
        if self.is_default_for_signup and not self.is_active:
            raise ValidationError({"is_active": _("The default signup plan must be active.")})


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    class Locale(models.TextChoices):
        VI = "vi", _("Vietnamese")
        EN = "en", _("English")

    class Theme(models.TextChoices):
        SYSTEM = "system", _("System")
        LIGHT = "light", _("Light")
        DARK = "dark", _("Dark")

    # Stored lowercased (see save); the functional constraint also guards raw writes.
    email = models.EmailField(max_length=254, unique=True)
    display_name = models.CharField(_("Display name"), max_length=100, blank=True)
    is_active = models.BooleanField(_("Active"), default=True)
    is_staff = models.BooleanField(_("Staff"), default=False)
    avatar_url = models.TextField(_("Avatar URL"), null=True, blank=True)  # noqa: DJ001
    locale = models.CharField(_("Language"), max_length=5, choices=Locale, default=Locale.VI)
    theme = models.CharField(_("Theme"), max_length=10, choices=Theme, default=Theme.SYSTEM)
    plan = models.ForeignKey(Plan, verbose_name=_("Plan"), on_delete=models.PROTECT)
    quota_override_bytes = models.PositiveBigIntegerField(
        _("Quota override (bytes)"), null=True, blank=True
    )
    used_bytes = models.PositiveBigIntegerField(_("Used storage (bytes)"), default=0)
    reserved_bytes = models.PositiveBigIntegerField(_("Reserved storage (bytes)"), default=0)
    root_folder = models.OneToOneField(
        "drive.Node",
        verbose_name=_("Root folder"),
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="root_user",
        editable=False,
    )
    suspended_at = models.DateTimeField(_("Suspended at"), null=True, blank=True)
    suspended_reason = models.TextField(_("Suspension reason"), null=True, blank=True)  # noqa: DJ001
    session_version = models.PositiveBigIntegerField(default=0, editable=False)

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    objects = UserManager()

    class Meta:
        verbose_name = _("User")
        verbose_name_plural = _("Users")
        constraints = [
            models.UniqueConstraint(Lower("email"), name="accounts_user_email_ci_unique"),
            models.CheckConstraint(condition=Q(locale__in=["vi", "en"]), name="user_locale"),
            models.CheckConstraint(
                condition=Q(theme__in=["system", "light", "dark"]), name="user_theme"
            ),
        ]

    def __str__(self) -> str:
        return self.email

    def _get_session_auth_hash(self, secret: str | None = None) -> str:
        return salted_hmac(
            "apps.accounts.User.session_auth_hash",
            f"{self.password}:{self.session_version}",
            secret=secret,
            algorithm="sha256",
        ).hexdigest()

    def clean(self) -> None:
        super().clean()
        if self.plan_id and not self.plan.is_active:
            previous = (
                type(self).objects.filter(pk=self.pk).values_list("plan_id", flat=True).first()
            )
            if previous != self.plan_id:
                raise ValidationError({"plan": _("The selected plan is inactive.")})

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = self.email.lower()
        if self._state.adding:
            from .services import save_new_user

            save_new_user(self, *args, **kwargs)
            return
        if kwargs.get("update_fields") is None:
            # A stale profile save must not undo suspension or session revocation.
            protected = {"session_version", "suspended_at", "suspended_reason"}
            kwargs["update_fields"] = [
                field.name
                for field in self._meta.concrete_fields
                if not field.primary_key and field.name not in protected
            ]
        super().save(*args, **kwargs)
