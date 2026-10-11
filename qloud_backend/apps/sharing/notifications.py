from django.conf import settings
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import translation
from django.utils.translation import gettext as _

from apps.accounts.tasks import send_email

from .models import Share


def schedule_share_email(share: Share) -> None:
    recipient, actor, node = share.grantee, share.created_by, share.node
    route = "folders" if node.kind == "folder" else "files"
    url = f"{settings.APP_BASE_URL.rstrip('/')}/drive/{route}/{node.pk.hex}"
    # Render before commit to retain the grant's original name, role and locale.
    with translation.override(recipient.locale):
        context = {
            "sharer": actor.display_name.strip() or actor.email,
            "name": node.name,
            "kind": _("Folder") if node.kind == "folder" else _("File"),
            "role": _("Can edit") if share.role == "editor" else _("Can view"),
            "url": url,
        }
        payload = {
            "subject": _("A new item has been shared with you on Qloud"),
            "body": render_to_string("sharing/email/share_message.txt", context),
            "html": render_to_string("sharing/email/share_message.html", context),
            "from_email": settings.DEFAULT_FROM_EMAIL,
            "to": [recipient.email],
        }
    transaction.on_commit(lambda: send_email.delay(**payload))
