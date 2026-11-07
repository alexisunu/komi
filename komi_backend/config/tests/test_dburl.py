from django.test import SimpleTestCase

from config.dburl import DatabaseUrlError, database_from_url

POOLER = (
    "postgresql://postgres.abcdefgh:p%40ss%2Fw%3Ard@aws-0-us-east-1.pooler.supabase.com:5432/"
    "postgres?sslmode=require&connect_timeout=10"
)


class DatabaseFromUrlTests(SimpleTestCase):
    def test_local_url_without_options(self):
        config = database_from_url("postgres://komi:secreto@localhost:5432/komi_db")
        self.assertEqual(
            config,
            {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "komi_db",
                "USER": "komi",
                "PASSWORD": "secreto",
                "HOST": "localhost",
                "PORT": "5432",
                "CONN_MAX_AGE": 0,
            },
        )

    def test_supabase_pooler_url_keeps_the_dotted_user_and_decodes_the_password(self):
        config = database_from_url(POOLER)
        self.assertEqual(config["USER"], "postgres.abcdefgh")
        self.assertEqual(config["PASSWORD"], "p@ss/w:rd")
        self.assertEqual(config["HOST"], "aws-0-us-east-1.pooler.supabase.com")
        self.assertEqual(config["NAME"], "postgres")
        self.assertEqual(config["OPTIONS"], {"sslmode": "require", "connect_timeout": 10})

    def test_an_escaped_user_is_decoded_too(self):
        config = database_from_url("postgres://usu%40rio:p@h/db")
        self.assertEqual(config["USER"], "usu@rio")

    def test_port_defaults_to_5432_and_is_read_when_given(self):
        self.assertEqual(database_from_url("postgres://u:p@h/db")["PORT"], "5432")
        self.assertEqual(database_from_url("postgres://u:p@h:6543/db")["PORT"], "6543")

    def test_both_postgres_schemes_are_accepted(self):
        for scheme in ("postgres", "postgresql"):
            with self.subTest(scheme=scheme):
                self.assertEqual(database_from_url(f"{scheme}://u:p@h/db")["NAME"], "db")

    def test_no_options_key_without_query_parameters(self):
        self.assertNotIn("OPTIONS", database_from_url("postgres://u:p@h/db"))

    def test_connections_close_after_each_request_by_default_and_can_be_configured(self):
        self.assertEqual(database_from_url("postgres://u:p@h/db")["CONN_MAX_AGE"], 0)
        self.assertEqual(
            database_from_url("postgres://u:p@h/db", conn_max_age=60)["CONN_MAX_AGE"], 60
        )

    def test_invalid_urls_are_rejected(self):
        for url in (
            "mysql://u:p@h/db",
            "http://u:p@h/db",
            "postgres://u:p@/db",
            "postgres://u:p@h",
            "postgres://u:p@h/",
            "",
            "no-es-una-url",
        ):
            with self.subTest(url=url), self.assertRaises(DatabaseUrlError):
                database_from_url(url)

    def test_invalid_options_are_rejected(self):
        for query in (
            "sslmode=raro",
            "connect_timeout=0",
            "connect_timeout=abc",
            "connect_timeout=-3",
            "pool=5",
        ):
            with self.subTest(query=query), self.assertRaises(DatabaseUrlError):
                database_from_url(f"postgres://u:p@h/db?{query}")

    def test_every_valid_ssl_mode_is_accepted(self):
        for mode in ("disable", "allow", "prefer", "require", "verify-ca", "verify-full"):
            with self.subTest(mode=mode):
                url = f"postgres://u:p@h/db?sslmode={mode}"
                self.assertEqual(database_from_url(url)["OPTIONS"]["sslmode"], mode)

    def test_errors_never_include_the_password(self):
        for url in ("mysql://u:clave-secreta@h/db", "postgres://u:clave-secreta@h/db?pool=5"):
            with self.subTest(url=url), self.assertRaises(DatabaseUrlError) as caught:
                database_from_url(url)
            self.assertNotIn("clave-secreta", str(caught.exception))
