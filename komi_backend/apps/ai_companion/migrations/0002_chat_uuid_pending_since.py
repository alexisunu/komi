import uuid

import django.db.models.deletion
from django.db import migrations, models


def refuse_if_data_exists(apps, schema_editor):
    """Cambiar la clave primaria de bigint a uuid exige recrear las tablas: solo si estan vacias."""
    Chat = apps.get_model("ai_companion", "ReflectionChat")
    if Chat.objects.exists():
        raise RuntimeError(
            "Hay charlas guardadas: no se puede recrear ReflectionChat con id UUID sin migrar "
            "los datos."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("ai_companion", "0001_initial"),
        ("reading_sessions", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(refuse_if_data_exists, migrations.RunPython.noop),
        migrations.DeleteModel(name="ReflectionMessage"),
        migrations.DeleteModel(name="ReflectionChat"),
        migrations.CreateModel(
            name="ReflectionChat",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("turn_count", models.SmallIntegerField(default=1)),
                ("is_closed", models.BooleanField(default=False)),
                ("key_takeaway", models.TextField(blank=True, null=True)),
                ("pending_since", models.DateTimeField(blank=True, null=True)),
                (
                    "session",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reflection_chat",
                        to="reading_sessions.readingsession",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="ReflectionMessage",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "sender",
                    models.CharField(
                        choices=[("KOMI_AI", "Komi Ai"), ("USER", "User")], max_length=8
                    ),
                ),
                ("content", models.TextField()),
                ("turn_number", models.SmallIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "chat",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="ai_companion.reflectionchat",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.AddConstraint(
            model_name="reflectionchat",
            constraint=models.CheckConstraint(
                condition=models.Q(("turn_count__gte", 1), ("turn_count__lte", 5)),
                name="reflectionchat_turn_count_1_5",
            ),
        ),
        migrations.AddConstraint(
            model_name="reflectionmessage",
            constraint=models.CheckConstraint(
                condition=models.Q(("turn_number__gte", 1), ("turn_number__lte", 5)),
                name="reflectionmessage_turn_number_1_5",
            ),
        ),
        migrations.AddConstraint(
            model_name="reflectionmessage",
            constraint=models.UniqueConstraint(
                fields=("chat", "sender", "turn_number"),
                name="reflectionmessage_one_per_sender_and_turn",
            ),
        ),
    ]
