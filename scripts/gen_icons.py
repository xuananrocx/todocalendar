"""Generate B and B+F application icons with 4x supersampling for antialiasing."""
import os
import numpy as np
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons')
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'icons')

C1 = (249, 115, 22)   # #f97316 orange
C2 = (236, 72, 153)   # #ec4899 pink
WHITE = (255, 255, 255, 255)
SUPERSAMPLE = 4


def make_gradient(size):
    xs = np.arange(size, dtype=np.float32).reshape(1, size, 1)
    ys = np.arange(size, dtype=np.float32).reshape(size, 1, 1)
    t = (xs + ys) / (size + size)
    c1 = np.array(C1, dtype=np.float32).reshape(1, 1, 3)
    c2 = np.array(C2, dtype=np.float32).reshape(1, 1, 3)
    rgb = c1 + (c2 - c1) * t
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    alpha = np.full((size, size, 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=2)
    return Image.fromarray(rgba, 'RGBA')


def make_rounded_gradient(size, radius_ratio=0.18):
    """Gradient square with rounded corners (transparent outside)."""
    img = make_gradient(size)
    mask = Image.new('L', (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    mdraw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    return img


def draw_check(draw, size):
    """Bold white check mark centered. Padded so visual feels compact."""
    cx = size * 0.50
    cy = size * 0.54
    w = size * 0.34
    sw = size * 0.085
    p1 = (cx - w * 0.45, cy + w * 0.05)
    p2 = (cx - w * 0.10, cy + w * 0.40)
    p3 = (cx + w * 0.55, cy - w * 0.45)
    draw.line([p1, p2], fill=WHITE, width=int(sw), joint='curve')
    draw.line([p2, p3], fill=WHITE, width=int(sw), joint='curve')
    cap = sw / 2
    for p in (p1, p2, p3):
        draw.ellipse([p[0] - cap, p[1] - cap, p[0] + cap, p[1] + cap], fill=WHITE)


def draw_calendar_lines(draw, size, sw):
    """Lucide calendar-check style icon, properly proportioned with padding."""
    # Calendar body (rounded rect) with more padding for compact look
    left = size * 0.22
    right = size * 0.78
    top = size * 0.24
    bottom = size * 0.82
    radius = size * 0.10
    draw.rounded_rectangle([left, top, right, bottom], radius=radius, outline=WHITE, width=int(sw))

    # Top binding rings (sticking up above the body)
    ring_top = top - size * 0.07
    ring_bot = top + size * 0.06
    ring_x1 = left + (right - left) * 0.28
    ring_x2 = left + (right - left) * 0.72
    draw.line([ring_x1, ring_top, ring_x1, ring_bot], fill=WHITE, width=int(sw))
    draw.line([ring_x2, ring_top, ring_x2, ring_bot], fill=WHITE, width=int(sw))

    # Header divider line
    header_y = top + (bottom - top) * 0.24
    draw.line([left, header_y, right, header_y], fill=WHITE, width=int(sw))

    # Check mark inside lower portion
    body_top = header_y
    body_bot = bottom
    body_left = left + sw / 2
    body_right = right - sw / 2
    body_cx = (body_left + body_right) / 2
    body_cy = (body_top + body_bot) / 2 - size * 0.04
    cw = (body_right - body_left) * 0.52
    ch = cw * 0.50
    cp1 = (body_cx - cw * 0.40, body_cy + ch * 0.20)
    cp2 = (body_cx - cw * 0.05, body_cy + ch * 0.55)
    cp3 = (body_cx + cw * 0.50, body_cy - ch * 0.45)
    csw = sw * 0.95
    draw.line([cp1, cp2], fill=WHITE, width=int(csw), joint='curve')
    draw.line([cp2, cp3], fill=WHITE, width=int(csw), joint='curve')
    cap = csw / 2
    for p in (cp1, cp2, cp3):
        draw.ellipse([p[0] - cap, p[1] - cap, p[0] + cap, p[1] + cap], fill=WHITE)


def render_b(size):
    big = size * SUPERSAMPLE
    img = make_rounded_gradient(big).copy()
    draw = ImageDraw.Draw(img)
    draw_check(draw, big)
    return img.resize((size, size), Image.LANCZOS)


def render_bf(size):
    big = size * SUPERSAMPLE
    img = make_rounded_gradient(big).copy()
    draw = ImageDraw.Draw(img)
    sw = big * 0.060
    draw_calendar_lines(draw, big, sw)
    return img.resize((size, size), Image.LANCZOS)


def save_png(img, path):
    img.save(path, 'PNG')


def save_ico(sources, path):
    # Use the largest image as base; PIL downscales to each requested size.
    max_size = max(sources.keys())
    base = sources[max_size]
    base.save(path, format='ICO', sizes=[(s, s) for s in sorted(sources.keys())])


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DIR, exist_ok=True)
    png_sizes = [32, 64, 128, 256, 512]
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]

    for name, render in (('b', render_b), ('bf', render_bf)):
        rendered = {sz: render(sz) for sz in set(png_sizes) | set(ico_sizes)}
        for sz in png_sizes:
            path = os.path.join(OUT_DIR, f'icon_{name}_{sz}.png')
            save_png(rendered[sz], path)
            print('wrote', path)
        ico_path = os.path.join(OUT_DIR, f'icon_{name}.ico')
        save_ico({sz: rendered[sz] for sz in ico_sizes}, ico_path)
        print('wrote', ico_path)
        # frontend copies (use 256 for crisp display at any size)
        fe_path = os.path.join(FRONTEND_DIR, f'icon_{name}.png')
        save_png(rendered[256], fe_path)
        print('wrote', fe_path)


if __name__ == '__main__':
    main()
