import django.contrib.postgres.indexes
from django.contrib.postgres.operations import TrigramExtension, UnaccentExtension
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("drive", "0006_objectdeletion")]

    operations = [
        UnaccentExtension(),
        TrigramExtension(),
        migrations.AddField(
            model_name="node",
            name="search_name",
            field=models.TextField(db_collation="C", default="", editable=False),
        ),
        migrations.RunSQL(
            sql="""
                CREATE FUNCTION qloud_node_search_name() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    NEW.search_name := lower(unaccent(normalize(NEW.name, NFC)) COLLATE "C");
                    RETURN NEW;
                END $$;
                CREATE TRIGGER node_search_name
                BEFORE INSERT OR UPDATE OF name, search_name ON drive_node
                FOR EACH ROW EXECUTE FUNCTION qloud_node_search_name();
                UPDATE drive_node
                SET search_name = lower(unaccent(normalize(name, NFC)) COLLATE "C");
            """,
            reverse_sql="""
                DROP TRIGGER node_search_name ON drive_node;
                DROP FUNCTION qloud_node_search_name();
            """,
        ),
        migrations.AddIndex(
            model_name="node",
            index=django.contrib.postgres.indexes.GinIndex(
                fields=["search_name"],
                name="node_search_trgm",
                opclasses=["gin_trgm_ops"],
            ),
        ),
    ]
