#!/usr/bin/env python3
"""Copy committed wall files from the ClimaScope app into its immersive repo."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

SOURCE_REPOSITORY = "https://github.com/Ashish-Dutta007/climascope"
MANIFEST = "SOURCE.json"
SHARED = {
    "immersive_remote.py", "immersive_context.py", "climate_profiles.py",
    "static/js/climate_profile.js", "static/css/climate_profile.css",
    "tools/precompute_place_profiles.py", "tools/capture_immersive_wall.py",
    "tools/sync_immersive_repo.py", "tests/test_climate_profiles.py",
    "tests/test_climate_profiles_flow.py", "docs/climate-profiles.md",
}


def managed(path):
    return path in SHARED or path.startswith(("static/immersive/", "docs/immersive/")) or (
        path.startswith("templates/immersive") and path.endswith(".html")) or (
        path.startswith("tests/test_immersive_") and path.endswith(".py")) or (
        path.startswith("tools/precompute_immersive_") and path.endswith(".py"))


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def digest(data):
    return hashlib.sha256(data).hexdigest()


def destination(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("Invalid managed path: " + name)
    result = root.joinpath(*path.parts)
    if not result.resolve().is_relative_to(root):
        raise ValueError("Path leaves the target repo: " + name)
    return result


def sync(source, target, write=False):
    source, target = source.resolve(), target.resolve()
    for root in (source, target):
        if Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve() != root:
            raise ValueError("Use a repository root: " + str(root))
    if source == target or not (source / "app.py").is_file():
        raise ValueError("Source must be the ClimaScope Flask app; target must be a different repo.")
    paths = sorted(p for p in git(source, "ls-tree", "-r", "--name-only", "HEAD").decode().splitlines() if managed(p))
    if "static/immersive/immersive.js" not in paths:
        raise ValueError("Source does not contain the wall renderer.")
    untracked = git(source, "ls-files", "--others", "--exclude-standard").decode().splitlines()
    if any(managed(p) for p in untracked) or git(source, "diff", "HEAD", "--", *paths):
        raise ValueError("Commit the source wall changes before syncing.")
    contents = {p: (source / p).read_bytes() for p in paths}
    commit = git(source, "rev-parse", "HEAD").decode().strip()
    manifest = {"repository": SOURCE_REPOSITORY, "commit": commit,
                "files": {p: digest(data) for p, data in contents.items()}}
    manifest_data = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()
    old_manifest = target / MANIFEST
    previous = json.loads(old_manifest.read_text()).get("files", {}) if old_manifest.is_file() else {}
    obsolete = sorted(set(previous) - set(paths))
    for p in obsolete:
        if not managed(p):
            raise ValueError("Unexpected path in the previous manifest: " + p)
    expected = {**contents, MANIFEST: manifest_data}
    different = [p for p, data in expected.items()
                 if not destination(target, p).is_file() or destination(target, p).read_bytes() != data]
    removals = [p for p in obsolete if destination(target, p).exists()]
    if not write:
        for p in different:
            print("UPDATE " + p)
        for p in removals:
            print("REMOVE " + p)
        print(f"Source {commit[:7]}: {len(paths)} managed files; {len(different)} updates, {len(removals)} removals.")
        return 1 if different or removals else 0
    owned = sorted(set(paths) | set(previous) | {MANIFEST})
    if git(target, "diff", "HEAD", "--", *owned):
        raise ValueError("The target has uncommitted wall changes; commit or resolve them before syncing.")
    tracked = set(git(target, "ls-files").decode().splitlines())
    for p in different:
        path = destination(target, p)
        if path.exists() and p not in tracked:
            raise ValueError("Would overwrite an untracked target file: " + p)
    for p in removals:
        path = destination(target, p)
        if digest(path.read_bytes()) != previous[p]:
            raise ValueError("A removed wall file was edited in the target: " + p)
    for p in different:
        path = destination(target, p)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(expected[p])
    for p in removals:
        destination(target, p).unlink()
    print(f"Synced {len(paths)} files from {commit[:7]}; {len(different)} updates, {len(removals)} removals.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="climascope-immersive checkout")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1], help="ClimaScope app checkout")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report differences without writing")
    mode.add_argument("--write", action="store_true", help="copy committed files and update SOURCE.json")
    args = parser.parse_args()
    try:
        return sync(args.source, args.target, args.write)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
