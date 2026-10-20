"""Repository sync checks using temporary Git repos, without climate data."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools/sync_immersive_repo.py"


class ImmersiveSync(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source, self.target = [Path(self.temp.name) / p for p in ("source", "target")]
        for root in (self.source, self.target):
            root.mkdir()
            self.git(root, "init", "-q")
            self.git(root, "config", "user.name", "Sync test")
            self.git(root, "config", "user.email", "sync@example.invalid")
        self.put(self.source, "app.py", "# Flask host\n")
        self.put(self.source, "static/immersive/immersive.js", "// Wall\n")
        self.put(self.source, "static/immersive/old.css", "body {}\n")
        self.put(self.source, "climate_profiles.py", "# Shared profiles\n")
        self.put(self.source, "static/js/dashboard_climate.js", "// Desktop\n")
        self.put(self.source, "data/raw.parquet", b"runtime data\x00")
        self.put(self.target, "README.md", "Wall repo notes\n")
        self.put(self.target, "docs/immersive/history.md", "Historical room check\n")
        self.commit(self.source)
        self.commit(self.target)

    def git(self, root, *args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.STDOUT)

    def put(self, root, path, data):
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data.encode() if isinstance(data, str) else data)

    def commit(self, root):
        self.git(root, "add", ".")
        self.git(root, "commit", "-qm", "Fixture update")

    def invoke(self, mode):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.target), "--source", str(self.source), mode],
                              capture_output=True, text=True, timeout=15)

    def test_export_hashes_shared_files_and_excludes_desktop_and_data(self):
        self.assertEqual(self.invoke("--check").returncode, 1)
        result = self.invoke("--write")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.target / "SOURCE.json").read_text())
        self.assertEqual(manifest["commit"], self.git(self.source, "rev-parse", "HEAD").decode().strip())
        for path, value in manifest["files"].items():
            self.assertEqual((self.target / path).read_bytes(), (self.source / path).read_bytes())
            self.assertEqual(hashlib.sha256((self.target / path).read_bytes()).hexdigest(), value)
        self.assertIn("climate_profiles.py", manifest["files"])
        for path in ("app.py", "static/js/dashboard_climate.js", "data/raw.parquet"):
            self.assertFalse((self.target / path).exists(), path)
        self.assertEqual(self.invoke("--check").returncode, 0)

    def test_uncommitted_edits_are_preserved(self):
        self.put(self.source, "static/immersive/immersive.js", "// Uncommitted source\n")
        self.assertEqual(self.invoke("--write").returncode, 2)
        self.assertFalse((self.target / "SOURCE.json").exists())
        self.git(self.source, "restore", "static/immersive/immersive.js")
        self.assertEqual(self.invoke("--write").returncode, 0)
        self.commit(self.target)
        self.put(self.target, "static/immersive/immersive.js", "// Uncommitted target\n")
        self.assertEqual(self.invoke("--write").returncode, 2)
        self.assertEqual((self.target / "static/immersive/immersive.js").read_text(), "// Uncommitted target\n")

    def test_removed_managed_files_are_pruned_and_history_is_kept(self):
        self.assertEqual(self.invoke("--write").returncode, 0)
        self.commit(self.target)
        self.git(self.source, "rm", "static/immersive/old.css")
        self.commit(self.source)
        self.assertEqual(self.invoke("--check").returncode, 1)
        self.assertEqual(self.invoke("--write").returncode, 0)
        self.assertFalse((self.target / "static/immersive/old.css").exists())
        self.assertEqual((self.target / "docs/immersive/history.md").read_text(), "Historical room check\n")
        self.assertEqual((self.target / "README.md").read_text(), "Wall repo notes\n")
        self.assertEqual(self.invoke("--check").returncode, 0)


if __name__ == "__main__":
    unittest.main()
