import math
import os

from PIL import Image, ImageDraw, ImageFilter

ASSETS = 'assets/images'
PUBLIC = 'public'

BLACK = (8, 8, 10, 255)
GLOW = (64, 8, 14, 255)
RED = (210, 16, 28, 255)
RED_DEEP = (150, 10, 20, 255)
WHITE = (238, 234, 236, 255)


def draw_cloud(draw: ImageDraw.ImageDraw, cx: float, cy: float, s: float,
               fill: tuple, outline: tuple, ow: float, shadow=None) -> None:
    def circle(x, y, r, color):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

    def poly(points, color):
        draw.polygon(points, fill=color)

    def arc_tail(px, py, pr, a0, a1, color, width):
        draw.arc([px - pr, py - pr, px + pr, py + pr], a0, a1, fill=color, width=int(width))

    big = s * 0.30
    med = s * 0.22
    small = s * 0.16

    body = [
        (cx - s * 0.52, cy + s * 0.10, med),
        (cx - s * 0.26, cy - s * 0.14, big),
        (cx + s * 0.04, cy - s * 0.26, big),
        (cx + s * 0.34, cy - s * 0.10, med),
        (cx + s * 0.54, cy + s * 0.12, med),
        (cx - s * 0.30, cy + s * 0.24, med),
        (cx + s * 0.06, cy + s * 0.28, med),
        (cx + s * 0.38, cy + s * 0.26, med),
    ]

    if shadow is not None:
        for x, y, r in body:
            circle(x + s * 0.02, y + s * 0.04, r, shadow)

    for x, y, r in body:
        circle(x, y, r + ow, outline)

    band_top = cy + s * 0.02
    band_bot = cy + s * 0.34
    draw.rectangle([cx - s * 0.55 - ow, band_top - ow, cx + s * 0.55 + ow, band_bot + ow], fill=outline)

    for x, y, r in body:
        circle(x, y, r, fill)

    draw.rectangle([cx - s * 0.55, band_top, cx + s * 0.55, band_bot], fill=fill)

    sw_r = s * 0.10
    for sx in (cx - s * 0.20, cx + s * 0.22):
        sy = band_bot + sw_r * 0.6
        circle(sx, sy, sw_r + ow, outline)
        circle(sx, sy, sw_r, fill)
        arc_tail(sx + sw_r * 1.1, sy - sw_r * 0.4, sw_r * 1.15, 200, 340, outline, ow * 1.6)
        arc_tail(sx + sw_r * 1.1, sy - sw_r * 0.4, sw_r * 1.05, 205, 335, fill, ow * 1.2)


def render(size: int, cloud_scale: float, bg_glow: bool, transparent: bool = False) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0) if transparent else BLACK)
    draw = ImageDraw.Draw(img)

    if bg_glow:
        glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow)
        gr = size * 0.55
        gdraw.ellipse([size / 2 - gr, size * 0.72 - gr * 0.7, size / 2 + gr, size * 0.72 + gr * 0.7], fill=GLOW)
        glow = glow.filter(ImageFilter.GaussianBlur(size * 0.16))
        img = Image.alpha_composite(img, glow)
        draw = ImageDraw.Draw(img)

    cx = size / 2
    cy = size * 0.46
    s = size * cloud_scale / 2.2

    draw_cloud(draw, cx, cy, s, RED, WHITE, s * 0.055)

    return img


def radial_dark_bg(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), BLACK)
    draw = ImageDraw.Draw(img)
    for radius_step in range(60, 0, -1):
        t = radius_step / 60
        r = size * 0.75 * t
        shade = int(10 + 26 * (1 - t))
        color = (shade + int(18 * (1 - t)), max(4, int(shade * 0.35)), max(6, int(shade * 0.45)), 255)
        draw.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=color)
    return img


def save_png(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    print('wrote', path, img.size)


def main() -> None:
    big = 2048

    icon_bg = radial_dark_bg(big)
    glow_layer = Image.new('RGBA', icon_bg.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow_layer)
    gr = big * 0.5
    gdraw.ellipse([big / 2 - gr, big * 0.78 - gr * 0.62, big / 2 + gr, big * 0.78 + gr * 0.62], fill=GLOW)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(big * 0.13))
    icon_bg = Image.alpha_composite(icon_bg, glow_layer)

    cloud = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(cloud)
    draw_cloud(cdraw, big / 2, big * 0.47, big * 0.42, RED, WHITE, big * 0.0090, shadow=RED_DEEP)

    icon_full = Image.alpha_composite(icon_bg, cloud)
    icon = icon_full.resize((1024, 1024), Image.LANCZOS)
    save_png(icon, f'{ASSETS}/icon.png')

    foreground = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    fdraw = ImageDraw.Draw(foreground)
    draw_cloud(fdraw, big / 2, big * 0.5, big * 0.36, RED, WHITE, big * 0.0080, shadow=RED_DEEP)
    adaptive = foreground.resize((1024, 1024), Image.LANCZOS)
    save_png(adaptive, f'{ASSETS}/adaptive-icon.png')

    save_png(icon.resize((192, 192), Image.LANCZOS), f'{PUBLIC}/icon-192.png')
    save_png(icon.resize((512, 512), Image.LANCZOS), f'{PUBLIC}/icon-512.png')

    mask_bg = Image.new('RGBA', (big, big), BLACK)
    mask_cloud = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    mdraw = ImageDraw.Draw(mask_cloud)
    draw_cloud(mdraw, big / 2, big * 0.5, big * 0.30, RED, WHITE, big * 0.0068, shadow=RED_DEEP)
    maskable = Image.alpha_composite(mask_bg, mask_cloud).resize((512, 512), Image.LANCZOS)
    save_png(maskable, f'{PUBLIC}/icon-maskable-512.png')

    save_png(icon.resize((180, 180), Image.LANCZOS), f'{PUBLIC}/apple-touch-icon.png')
    save_png(icon.resize((48, 48), Image.LANCZOS), f'{ASSETS}/favicon.png')

    wordmark = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    wdraw = ImageDraw.Draw(wordmark)
    draw_cloud(wdraw, 256, 252, 130, RED, WHITE, 5.4)
    save_png(wordmark.resize((96, 96), Image.LANCZOS), f'{ASSETS}/akatsuki-cloud.png')


if __name__ == '__main__':
    main()