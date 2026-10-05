#!/usr/bin/env python3
"""앱 아이콘을 그린다.

COMMON 펫 두더지(003) 1단계 카드 그림만 투명 배경에 크게 올린 도트 아이콘이다. 판이나 테두리
없이 두더지 모양 그대로가 아이콘이 된다. 트레이 아이콘(`tools/tray-icon.py`)과 같은 관례로,
이미지 에셋은 손으로 고치지 않고 이 스크립트로 다시 만든다.

## 크기

macOS `.icns`는 16·32·64·128·256·512·1024px 를 담는다. 도트는 정수 배율로만 키워야
하므로(design.md §4) 아이콘 전체를 **128×128 격자**에 그린 뒤 최근접 보간으로 ×8(1024),
×4(512), ×2(256), ×1(128) 키운다. 64px 이하는 정수로 줄일 수 없어 128px 을 부드럽게
축소한다 — Dock 의 작은 표시용이라 OS 도 그렇게 줄인다.

두더지(20×17)는 격자에서 5배로 그려 가로 100칸을 차지한다. 애플 아이콘 그리드의 본체
폭(1024 중 824px, 격자 약 103칸) 안에 든다.

    .venv/bin/python tools/app-icon.py
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITE = ROOT / "apps/desktop/renderer/assets/pets/common/mole_digger/stage1/pet_003_s1_card.png"
OUT_DIR = ROOT / "apps" / "desktop" / "resources"

GRID = 128
SPRITE_SCALE = 5


def render_master() -> Image.Image:
    """투명 격자 가운데에 두더지를 정수 배율로 올린다. 빈 여백은 잘라 낸 뒤 키운다."""
    card = Image.open(SPRITE).convert("RGBA")
    pet = card.crop(card.getbbox())
    pet = pet.resize((pet.width * SPRITE_SCALE, pet.height * SPRITE_SCALE), Image.NEAREST)
    canvas = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    canvas.alpha_composite(pet, ((GRID - pet.width) // 2, (GRID - pet.height) // 2))
    return canvas


def at_size(master: Image.Image, size: int) -> Image.Image:
    if size >= GRID:
        return master.resize((size, size), Image.NEAREST)
    return master.resize((size, size), Image.LANCZOS)


def main() -> None:
    master = render_master()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    at_size(master, 1024).save(OUT_DIR / "icon.png")

    # iconutil 이 요구하는 이름과 크기.
    entries = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    if shutil.which("iconutil") is None:
        print("iconutil 이 없어 icon.icns 는 만들지 않았습니다(macOS 전용).")
        return
    with tempfile.TemporaryDirectory() as temp:
        iconset = Path(temp) / "icon.iconset"
        iconset.mkdir()
        for name, size in entries.items():
            at_size(master, size).save(iconset / name)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT_DIR / "icon.icns")],
            check=True,
        )
    print(f"{OUT_DIR / 'icon.png'}, {OUT_DIR / 'icon.icns'}")


if __name__ == "__main__":
    main()
