"""Build reproducible app ZIPs and tessera-apps.json for a public GitHub repo.

Usage: python tools/build-app-catalog.py examples/html-apps --output C:/my-app-repo
No network calls, package scripts, or publication steps are performed.
"""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path


def build(source: Path, output: Path):
    source = source.resolve(strict=True)
    output = output.resolve()
    if output == source or source in output.parents:
        raise ValueError("Output must be outside the source app folders")
    apps = []
    identities = set()
    packages = output / "packages"
    packages.mkdir(parents=True, exist_ok=True)
    for manifest_file in sorted(source.glob("*/manifest.json")):
        folder = manifest_file.parent
        manifest = json.loads(manifest_file.read_text(encoding="utf-8-sig"))
        identity = manifest["id"]
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,79}", identity) or identity in identities:
            raise ValueError(f"Invalid or duplicate app ID: {identity}")
        identities.add(identity)
        files = sorted(p for p in folder.rglob("*") if p.is_file())
        if len(files) > 512 or sum(p.stat().st_size for p in files) > 32 * 1024 * 1024:
            raise ValueError(f"App too large: {identity}")
        # Version is display metadata, never part of a filesystem path.
        package_path = packages / f"{identity}.zip"
        with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in files:
                relative = path.relative_to(folder).as_posix()
                if path.is_symlink() or folder.resolve() not in path.resolve().parents or path.stat().st_size > 8 * 1024 * 1024:
                    raise ValueError(f"Linked, external, or oversized asset: {relative}")
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
        apps.append({
            "id": identity, "name": manifest["name"], "version": manifest["version"],
            "description": manifest.get("description", ""),
            "category": "Games" if manifest.get("icon") in ["Gamepad2", "Dice5", "Trophy"] else "Tools",
            "icon": manifest.get("icon", "Puzzle") if not "." in manifest.get("icon", "Puzzle") else "Puzzle",
            "package": package_path.relative_to(output).as_posix(),
            "sha256": hashlib.sha256(package_path.read_bytes()).hexdigest(),
        })
    if not apps:
        raise ValueError("No app folders containing manifest.json were found")
    (output / "tessera-apps.json").write_text(json.dumps({"version": 1, "apps": apps}, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(apps)} apps in {output}. Review and commit these files to your public repository.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.output)
