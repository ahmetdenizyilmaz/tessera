"""Keep stable builds on Tessera's app icon, never a provider logo.

Regenerate from the canonical vector asset first:
    npx tauri icon src/assets/tessera-icon.svg
Then refresh stable aliases:
    python tools/make-stable-icon.py

The application name distinguishes Tessera Preview from stable Tessera.
"""
from pathlib import Path
from shutil import copyfile

ICONS = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"

if __name__ == "__main__":
    for source, target in (
        ("icon.ico", "icon-stable.ico"),
        ("32x32.png", "32x32-stable.png"),
        ("128x128.png", "128x128-stable.png"),
    ):
        copyfile(ICONS / source, ICONS / target)
        print(f"Updated {target}")
