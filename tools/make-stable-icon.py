"""Generate the stable build's icon from the base icon.

The dev/debug build keeps the original icon; the stable build gets this
variant so the two are instantly distinguishable in the taskbar and Alt-Tab.
Distinguishing marks: a deep slate rounded-square plate behind the logo and a
green "release" dot in the corner (green = the build you actually use).

    python tools/make-stable-icon.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
# The bundle icons are placeholders (a flat orange square and a black PNG);
# the real Claude mark is the one the UI uses for tabs.
SRC = ROOT / "src" / "assets" / "claude-icon.ico"

PLATE = (24, 26, 37, 255)      # slate backing, matches the app's dark chrome
DOT = (63, 185, 80, 255)       # green release dot
DOT_EDGE = (16, 18, 26, 255)


def build(size: int) -> Image.Image:
    base = Image.open(SRC).convert("RGBA").resize((size, size), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Rounded plate so the silhouette differs from the bare dev logo
    radius = max(2, round(size * 0.22))
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=PLATE)

    # Logo inset on the plate
    inset = max(1, round(size * 0.14))
    logo = base.resize((size - inset * 2, size - inset * 2), Image.LANCZOS)
    canvas.paste(logo, (inset, inset), logo)

    # Green corner dot — only drawn when it stays legible
    if size >= 24:
        d = round(size * 0.30)
        pad = round(size * 0.05)
        box = [size - d - pad, size - d - pad, size - pad, size - pad]
        draw.ellipse(box, fill=DOT, outline=DOT_EDGE, width=max(1, round(size * 0.03)))

    return canvas


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [build(s) for s in sizes]

    ico = ICONS / "icon-stable.ico"
    frames[-1].save(ico, format="ICO", sizes=[(s, s) for s in sizes])
    build(32).save(ICONS / "32x32-stable.png")
    build(128).save(ICONS / "128x128-stable.png")

    print(f"wrote {ico.name}, 32x32-stable.png, 128x128-stable.png")


if __name__ == "__main__":
    main()
