#!/usr/bin/env python3
"""트레이 아이콘을 그린다.

## 왜 스크립트로 남기는가

`docs/pet-assets-guide.md`가 정한 관례다 — 이미지 에셋은 손으로 고치지 않고 재생성한다.
16px짜리 아이콘도 예외가 아니다. 나중에 모양을 바꿀 때 픽셀을 다시 찍지 않아도 된다.

## macOS 템플릿 이미지 규칙

파일명이 `Template`로 끝나면 macOS가 **알파만 읽어** 메뉴 바 색에 맞춰 자동으로 칠한다.
그래서 색을 넣지 않고 검정 + 알파로만 그린다. 라이트/다크 메뉴 바 양쪽에서 알아서 보인다.

    python3 tools/tray-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "apps" / "desktop" / "resources"
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)


def draw_pet(size: int) -> Image.Image:
    """펫 머리 실루엣. 16px에서도 읽히도록 귀·얼굴만 남긴 형태다."""
    # 4배로 그린 뒤 줄여 가장자리를 정리한다. 도트 에셋과 달리 트레이 아이콘은
    # 메뉴 바 높이에 맞춰 OS가 다시 스케일하므로 nearest를 고집할 이유가 없다.
    scale = 4
    side = size * scale
    image = Image.new("RGBA", (side, side), CLEAR)
    draw = ImageDraw.Draw(image)

    unit = side / 16

    def box(x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float]:
        return (x0 * unit, y0 * unit, x1 * unit, y1 * unit)

    # 귀 두 개.
    draw.polygon([(2.4 * unit, 5.2 * unit), (4.2 * unit, 1.6 * unit), (6.2 * unit, 4.6 * unit)], fill=BLACK)
    draw.polygon([(13.6 * unit, 5.2 * unit), (11.8 * unit, 1.6 * unit), (9.8 * unit, 4.6 * unit)], fill=BLACK)

    # 머리.
    draw.ellipse(box(2, 3.6, 14, 14.2), fill=BLACK)

    # 눈 두 개를 파낸다. 알파를 뚫어야 템플릿에서 흰 눈으로 보인다.
    draw.ellipse(box(5.1, 7.4, 7.1, 9.8), fill=CLEAR)
    draw.ellipse(box(8.9, 7.4, 10.9, 9.8), fill=CLEAR)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size, name in ((16, "trayTemplate.png"), (32, "trayTemplate@2x.png")):
        path = OUT_DIR / name
        draw_pet(size).save(path)
        print(f"{path.relative_to(OUT_DIR.parent.parent.parent)} — {size}x{size}")


if __name__ == "__main__":
    main()
