from django.db import migrations

# Django cannot declare a multi-column foreign key. With MATCH SIMPLE (the default) a
# NULL current_version_id is not checked, so "create node, create version, point the
# node at it" still works; pointing a node at another node's version fails.
FORWARD = """
ALTER TABLE drive_fileversion
    ADD CONSTRAINT file_version_id_node UNIQUE (id, node_id);
ALTER TABLE drive_node
    ADD CONSTRAINT node_current_version_own
    FOREIGN KEY (current_version_id, id) REFERENCES drive_fileversion (id, node_id)
    ON DELETE SET NULL (current_version_id)
    DEFERRABLE INITIALLY DEFERRED;
"""
REVERSE = """
ALTER TABLE drive_node DROP CONSTRAINT node_current_version_own;
ALTER TABLE drive_fileversion DROP CONSTRAINT file_version_id_node;
"""


class Migration(migrations.Migration):
    dependencies = [("drive", "0003_natural_name_order")]

    operations = [migrations.RunSQL(FORWARD, REVERSE)]
