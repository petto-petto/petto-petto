#!/usr/bin/env python3
"""grid.py 포맷(.txt)을 PNG로 직접 렌더링한다 — Piskel 없이.

색이 legend의 hex 그대로 픽셀에 찍히므로 draw_pixels를 색당 한 번씩 부르는
것과 결과가 동일하다(실측: 1024픽셀 diff 0). Piskel 프로젝트 생성·기기 왕복이
없어 카드 한 장 기준 수십 번의 도구 호출이 1번으로 줄어든다.

Usage:
    python3 render_png.py card.txt --out card.png
    python3 render_png.py f0.txt f1.txt f2.txt f3.txt --sheet idle.png   # 가로 1행 시트
    python3 render_png.py f0.txt f1.txt f2.txt f3.txt --gif idle.gif --fps 6
"""
import argparse
import re
import sys


def load(path):
    legend, rows, section = {}, [], None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        s = line.strip()
        if s.lower() == "[legend]":
            section = "legend"; continue
        if s.lower() == "[grid]":
            section = "grid"; continue
        if section == "legend":
            if not s or s.startswith("#"):
                continue
            m = re.match(r"^(\S)\s*=\s*(#?[0-9A-Fa-f]{3,8})", s)
            if not m:
                raise SystemExit(f"bad legend line: {s!r}")
            ch, hexcol = m.group(1), m.group(2)
            if not hexcol.startswith("#"):
                hexcol = "#" + hexcol
            legend[ch] = hexcol.upper()
        elif section == "grid":
            if not s:
                continue
            rows.append(line.split("#")[0].rstrip())
    if not legend or not rows:
        raise SystemExit(f"{path}: no [legend]/[grid] section")
    return legend, rows


def hex_to_rgba(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def render(path):
    from PIL import Image
    legend, rows = load(path)
    h = len(rows)
    w = len(rows[0])
    for r in rows:
        if len(r) != w:
            raise SystemExit(f"{path}: 행 길이가 일정하지 않다 ({len(r)} vs {w})")
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "." or ch not in legend:
                continue
            px[x, y] = hex_to_rgba(legend[ch])
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("grids", nargs="+", help="grid.py 포맷 .txt 파일 (프레임 순서대로)")
    ap.add_argument("--out", help="단일 프레임을 PNG로 저장")
    ap.add_argument("--sheet", help="여러 프레임을 가로 1행 스프라이트시트 PNG로 저장")
    ap.add_argument("--gif", help="여러 프레임을 애니메이션 GIF로 저장 (미리보기용)")
    ap.add_argument("--fps", type=float, default=6.0)
    args = ap.parse_args()

    if not (args.out or args.sheet or args.gif):
        raise SystemExit("--out / --sheet / --gif 중 하나는 지정할 것")

    frames = [render(p) for p in args.grids]

    if args.out:
        if len(frames) != 1:
            raise SystemExit("--out은 프레임 1장일 때만 — 여러 장이면 --sheet/--gif")
        frames[0].save(args.out)
        print(f"written: {args.out}  ({frames[0].size[0]}x{frames[0].size[1]})")

    if args.sheet:
        from PIL import Image
        w, h = frames[0].size
        for f in frames:
            if f.size != (w, h):
                raise SystemExit("모든 프레임의 캔버스 크기가 같아야 한다")
        sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            sheet.paste(f, (w * i, 0), f)
        sheet.save(args.sheet)
        print(f"written: {args.sheet}  ({len(frames)} frames, {w}x{h} each, "
             f"columns={len(frames)})")

    if args.gif:
        duration_ms = round(1000 / args.fps)
        frames[0].save(args.gif, save_all=True, append_images=frames[1:],
                       duration=duration_ms, loop=0, disposal=2)
        print(f"written: {args.gif}  ({len(frames)} frames @ {args.fps}fps, 미리보기용)")


if __name__ == "__main__":
    main()
