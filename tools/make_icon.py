"""生成一张 1024x1024 纯色 PNG 作为 Tauri 应用图标的源文件。
之后用 `npm run tauri icon` 生成各平台所需尺寸。
"""
import struct
import zlib
import sys
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "icon.png")

W, H = 1024, 1024

# 一个简单的渐变背景,看起来像个日历+对勾
def color_at(x, y):
    # 紫色主背景
    r, g, b = 99, 102, 241
    # 中央圆角矩形稍亮
    cx, cy = W // 2, H // 2
    dx = abs(x - cx)
    dy = abs(y - cy)
    if dx < 320 and dy < 320:
        # 在中央区域
        # 画一个对勾(简化的几条粗线)
        # 对勾路径:(700, 470) -> (790, 560) -> (950, 380) 缩放到中央
        # 用极坐标偏移近似
        pass
    return r, g, b, 255

# 简单方案:纯色 + 中央一个白色圆角矩形 + 对勾线条
def make_image():
    bg_r, bg_g, bg_b = 99, 102, 241  # indigo #6366f1

    # 中央白色圆角矩形边界
    rect_x1, rect_y1 = 256, 336
    rect_x2, rect_y2 = 768, 848

    # 对勾的三个点(在矩形内)
    # tick points (in 1024 space)
    p1 = (380, 580)
    p2 = (470, 680)
    p3 = (660, 460)

    def dist_to_segment(px, py, x1, y1, x2, y2):
        # 点到线段距离
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
        t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        cx, cy = x1 + t * dx, y1 + t * dy
        return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5

    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter byte
        for x in range(W):
            # 圆角矩形判定
            in_rect = rect_x1 <= x <= rect_x2 and rect_y1 <= y <= rect_y2
            # 简单圆角:四角 60px 内切
            corner = 40
            if in_rect:
                # 检查是否在圆角内
                if x < rect_x1 + corner and y < rect_y1 + corner:
                    if (x - rect_x1 - corner) ** 2 + (y - rect_y1 - corner) ** 2 > corner ** 2:
                        in_rect = False
                elif x > rect_x2 - corner and y < rect_y1 + corner:
                    if (x - rect_x2 + corner) ** 2 + (y - rect_y1 - corner) ** 2 > corner ** 2:
                        in_rect = False
                elif x < rect_x1 + corner and y > rect_y2 - corner:
                    if (x - rect_x1 - corner) ** 2 + (y - rect_y2 + corner) ** 2 > corner ** 2:
                        in_rect = False
                elif x > rect_x2 - corner and y > rect_y2 - corner:
                    if (x - rect_x2 + corner) ** 2 + (y - rect_y2 + corner) ** 2 > corner ** 2:
                        in_rect = False

            if in_rect:
                # 检查对勾
                d1 = dist_to_segment(x, y, p1[0], p1[1], p2[0], p2[1])
                d2 = dist_to_segment(x, y, p2[0], p2[1], p3[0], p3[1])
                d = min(d1, d2)
                if d < 22:
                    # 对勾紫色
                    raw.extend([bg_r, bg_g, bg_b, 255])
                else:
                    # 白色
                    raw.extend([255, 255, 255, 255])
            else:
                # 背景紫色
                raw.extend([bg_r, bg_g, bg_b, 255])
    return bytes(raw)


def write_png(path, w, h, raw):
    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    out = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print(f"生成 {W}x{H} 图标到 {out} ...")
    raw = make_image()
    write_png(out, W, H, raw)
    size = os.path.getsize(out)
    print(f"完成,文件大小 {size} 字节")
