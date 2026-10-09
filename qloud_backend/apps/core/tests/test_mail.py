from django.core import mail


def test_default_mailer_delivers_to_outbox_in_tests():
    mail.send_mail("Subject", "Body", None, ["user@example.com"])

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["user@example.com"]
