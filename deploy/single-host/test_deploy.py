"""Run with python3 -m unittest discover -s deploy/single-host -p 'test_*.py'."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("deploy_config", DIRECTORY / "config.py")
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = Path(self.directory.name) / ".env"
        self.command = [
            "python3", str(DIRECTORY / "config.py"), "init", str(self.env),
            "admin.example.com", "console.example.com", "api.example.com",
            "10.0.1.10", "203.0.113.10/32 2001:db8::1/128", "none",
        ]
        self.result = subprocess.run(self.command, capture_output=True, text=True, check=True)
        self.values = config.read_config(self.env)

    def test_render_separates_credentials_and_uses_clb_private_ingress(self):
        output = self.env.parent / "rendered"
        config.render_host(self.values, output)
        def read_environment(filename):
            return dict(line.split("=", 1) for line in (output / filename).read_text().splitlines())
        gateway = read_environment("management.env")
        portal = read_environment("portal.env")
        infra = read_environment("infra/.env")
        self.assertNotIn("SESSION_SECRET", portal)
        self.assertNotIn("CRYPTO_SECRET", infra)
        self.assertNotIn("POSTGRES_PASSWORD", gateway)
        self.assertNotIn("POSTGRES_PASSWORD", portal)
        for environment in (portal, gateway):
            self.assertEqual(environment["LISTEN_ADDRESS"], "10.0.1.10")
            self.assertEqual(environment["TRUSTED_PROXIES"], "none")
            self.assertEqual(environment["CLB_INGRESS_ENABLED"], "true")
            self.assertIn("@127.0.0.1:15432/", environment["SQL_DSN"])
            self.assertIn("@127.0.0.1:16379/", environment["REDIS_CONN_STRING"])
        self.assertEqual(portal["PORT"], "3001")
        self.assertEqual(gateway["PORT"], "3000")
        self.assertEqual(portal["SERVICE_ROLE"], "portal")
        self.assertEqual(portal["PORTAL_GATEWAY_INTERNAL_URL"], "http://10.0.1.10:3000")
        self.assertEqual(gateway["INGRESS_ADMIN_CIDRS"], self.values["ADMIN_ALLOW_CIDRS"])
        self.assertFalse((output / "Caddyfile").exists())
        for filename in ("management.env", "portal.env", "infra/.env"):
            self.assertEqual((output / filename).stat().st_mode & 0o777, 0o600)
        original_key = portal["CRYPTO_SECRET"]
        config.render_host(self.values, output)
        self.assertEqual(read_environment("portal.env")["CRYPTO_SECRET"], original_key)

    def test_legacy_configuration_preserves_existing_keys(self):
        lines = self.env.read_text().splitlines()
        lines = [line for line in lines if line.partition("=")[0] not in config.PORT_DEFAULTS]
        self.env.write_text("\n".join(lines) + "\nAPP_IMAGE=new-api:single-host\nEDGE_PREFIX=172.30.61\n")
        migrated = config.read_config(self.env)
        self.assertEqual(migrated, self.values)

    def test_release_rejects_changed_assets_and_symlinks(self):
        release = self.env.parent / "release"
        (release / "portal").mkdir(parents=True)
        for name in ("new-api",):
            (release / name).write_text("binary fixture")
        (release / "portal/index.html").write_text('<meta name="new-api-surface" content="portal">')
        subprocess.run(["python3", str(DIRECTORY / "config.py"), "seal-release", str(release)], check=True)
        subprocess.run(["python3", str(DIRECTORY / "config.py"), "verify-release", str(release)], check=True)
        (release / "portal/index.html").write_text('<meta name="new-api-surface" content="portal">modified')
        result = subprocess.run(["python3", str(DIRECTORY / "config.py"), "verify-release", str(release)], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        (release / "external").symlink_to(self.env)
        with self.assertRaises(ValueError):
            config.release_manifest(release)

    def test_init_preserves_keys_and_does_not_print_them(self):
        original = self.env.read_bytes()
        retry = subprocess.run(self.command, capture_output=True, text=True)
        self.assertNotEqual(retry.returncode, 0)
        self.assertEqual(self.env.read_bytes(), original)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)
        for key in config.SECRET_KEYS:
            self.assertNotIn(self.values[key], self.result.stdout + self.result.stderr + retry.stdout + retry.stderr)
        self.assertEqual(len(set(self.values[k] for k in config.SECRET_KEYS)), len(config.SECRET_KEYS))

    def test_rejects_symlink_and_readable_secrets(self):
        link = self.env.parent / "linked-env"
        link.symlink_to(self.env)
        with self.assertRaises(ValueError):
            config.read_config(link)
        self.env.chmod(0o644)
        with self.assertRaises(ValueError):
            config.read_config(self.env)

    def test_rejects_invalid_ingress_and_shared_secrets(self):
        for key, value in (
            ("ADMIN_DOMAIN", "https://admin.example.com"),
            ("ADMIN_DOMAIN", "console.example.com"),
            ("ADMIN_DOMAIN", "127.0.0.1"),
            ("ADMIN_ALLOW_CIDRS", "0.0.0.0/0"),
            ("ADMIN_ALLOW_CIDRS", "::/0"),
            ("ADMIN_ALLOW_CIDRS", "203.0.113.10/32\nrespond 200"),
            ("BACKEND_IP", "0.0.0.0"),
            ("BACKEND_IP", "127.0.0.1"),
            ("BACKEND_IP", "8.8.8.8"),
            ("TRUSTED_PROXY_CIDRS", "0.0.0.0/0"),
            ("PG_PORT", "80"),
            ("PORTAL_PORT", "3000"),
            ("PORTAL_SESSION_SECRET", self.values["MANAGEMENT_SESSION_SECRET"]),
        ):
            with self.subTest(field=key):
                changed = copy.copy(self.values)
                changed[key] = value
                with self.assertRaises(ValueError):
                    config.validate(changed)

    def test_config_is_not_shell_code_and_errors_hide_values(self):
        marker = self.env.parent / "must-not-exist"
        self.env.write_text(self.env.read_text().replace("admin.example.com", "$(touch " + str(marker) + ")"))
        result = subprocess.run(["python3", str(DIRECTORY / "config.py"), "validate", str(self.env)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertNotIn(str(marker), result.stdout + result.stderr)

    def test_migration_preserves_existing_crypto_value(self):
        changed = copy.copy(self.values)
        changed["CRYPTO_SECRET"] = "existing-data-key-do-not-rotate"
        config.validate(changed)
        self.assertEqual(changed["CRYPTO_SECRET"], "existing-data-key-do-not-rotate")

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI required; no daemon needed")
    def test_compose_keeps_secrets_and_ports_on_the_correct_services(self):
        env = {key: value for key, value in os.environ.items() if key not in self.values}
        result = subprocess.run([
            "docker", "compose", "--project-name", "new-api", "--project-directory", str(DIRECTORY),
            "--env-file", str(self.env), "-f", str(DIRECTORY / "compose.yaml"),
            "--profile", "portal", "config", "--format", "json",
        ], capture_output=True, text=True, env=env)
        # Do not include rendered configuration in failure messages: it contains secrets.
        self.assertEqual(result.returncode, 0, "Compose config failed")
        rendered = json.loads(result.stdout)
        services = rendered["services"]
        self.assertEqual(set(services), {"postgres", "redis"})
        for name, port in (("postgres", "15432"), ("redis", "16379")):
            self.assertEqual(len(services[name]["ports"]), 1)
            self.assertEqual(services[name]["ports"][0]["host_ip"], "127.0.0.1")
            self.assertEqual(str(services[name]["ports"][0]["published"]), port)
            self.assertNotIn("CRYPTO_SECRET", services[name]["environment"])
        self.assertTrue(rendered["networks"]["data"]["internal"])



if __name__ == "__main__":
    unittest.main()
