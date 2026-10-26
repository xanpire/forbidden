import math
import os

from PIL import Image, ImageDraw, ImageFilter

ASSETS = 'assets/images'
PUBLIC = 'public'

BLACK = (7, 7, 9, 255)
GLOW = (64, 8, 14, 255)
RED = (214, 18, 30, 255)
WHITE = (238, 234, 236, 255)


def stroke_polygon(draw, points, fill, stroke_width, cx, cy):
    offsets = []
    for angle in range(0, 360, 45):
        a = math.radians(angle)
        offsets.append((math.cos(a) * stroke_width, math.sin(a) * stroke_width))

    for dx, dy in offsets:
        draw.polygon([(x + dx, y + dy) for x, y in points], fill=fill)


def build_shapes(size):
    cx = size / 2
    s = size

    head_y = s * 0.308
    head_r = s * 0.0215

    head = (cx, head_y)

    beak = [
        (cx + head_r * 0.40, head_y - head_r * 0.55),
        (cx + head_r * 2.90, head_y - head_r * 0.10),
        (cx + head_r * 2.55, head_y + head_r * 2.10),
        (cx + head_r * 1.55, head_y + head_r * 0.90),
        (cx + head_r * 0.50, head_y + head_r * 0.80),
    ]

    neck_body = [
        (cx - s * 0.018, head_y + head_r * 0.9),
        (cx + s * 0.018, head_y + head_r * 0.9),
        (cx + s * 0.035, s * 0.415),
        (cx + s * 0.062, s * 0.475),
        (cx + s * 0.030, s * 0.585),
        (cx - s * 0.030, s * 0.585),
        (cx - s * 0.062, s * 0.475),
        (cx - s * 0.035, s * 0.415),
    ]

    tail = [
        (cx - s * 0.032, s * 0.565),
        (cx - s * 0.088, s * 0.700),
        (cx - s * 0.042, s * 0.672),
        (cx, s * 0.712),
        (cx + s * 0.042, s * 0.672),
        (cx + s * 0.088, s * 0.700),
        (cx + s * 0.032, s * 0.565),
    ]

    def wing(side):
        sgn = -1 if side < 0 else 1
        shoulder_top = (cx + sgn * s * 0.040, s * 0.452)
        tip1 = (cx + sgn * s * 0.318, s * 0.322)
        notch1 = (cx + sgn * s * 0.268, s * 0.372)
        tip2 = (cx + sgn * s * 0.296, s * 0.408)
        notch2 = (cx + sgn * s * 0.246, s * 0.446)
        tip3 = (cx + sgn * s * 0.266, s * 0.478)
        notch3 = (cx + sgn * s * 0.218, s * 0.504)
        tip4 = (cx + sgn * s * 0.230, s * 0.526)
        notch4 = (cx + sgn * s * 0.182, s * 0.536)
        tip5 = (cx + sgn * s * 0.172, s * 0.556)
        inner = (cx + sgn * s * 0.058, s * 0.470)
        armpit = (cx + sgn * s * 0.052, s * 0.505)

        return [
            shoulder_top,
            tip1,
            notch1,
            tip2,
            notch2,
            tip3,
            notch3,
            tip4,
            notch4,
            tip5,
            inner,
            armpit,
        ]

    return {
        'head': head,
        'head_r': head_r,
        'beak': beak,
        'neck_body': neck_body,
        'tail': tail,
        'wing_l': wing(-1),
        'wing_r': wing(1),
        'cx': cx,
    }


def vulture_canvas(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    shapes = build_shapes(size)

    stroke = size * 0.011

    stroke_polygon(draw, shapes['wing_l'], WHITE, stroke, shapes['cx'], size * 0.45)
    stroke_polygon(draw, shapes['wing_r'], WHITE, stroke, shapes['cx'], size * 0.45)
    stroke_polygon(draw, shapes['tail'], WHITE, stroke, shapes['cx'], size * 0.45)
    stroke_polygon(draw, shapes['neck_body'], WHITE, stroke, shapes['cx'], size * 0.45)
    stroke_polygon(draw, shapes['beak'], WHITE, stroke, shapes['cx'], size * 0.45)
    draw.ellipse(
        [
            shapes['head'][0] - shapes['head_r'] - stroke,
            shapes['head'][1] - shapes['head_r'] - stroke,
            shapes['head'][0] + shapes['head_r'] + stroke,
            shapes['head'][1] + shapes['head_r'] + stroke,
        ],
        fill=WHITE,
    )

    draw.polygon(shapes['wing_l'], fill=RED)
    draw.polygon(shapes['wing_r'], fill=RED)
    draw.polygon(shapes['tail'], fill=RED)
    draw.polygon(shapes['neck_body'], fill=RED)
    draw.polygon(shapes['beak'], fill=RED)
    draw.ellipse(
        [
            shapes['head'][0] - shapes['head_r'],
            shapes['head'][1] - shapes['head_r'],
            shapes['head'][0] + shapes['head_r'],
            shapes['head'][1] + shapes['head_r'],
        ],
        fill=RED,
    )

    eye_r = shapes['head_r'] * 0.32
    eye_x = shapes['head'][0] + shapes['head_r'] * 0.42
    eye_y = shapes['head'][1] - shapes['head_r'] * 0.15
    draw.ellipse([eye_x - eye_r, eye_y - eye_r, eye_x + eye_r, eye_y + eye_r], fill=BLACK)

    return img


def render_icon(size):
    big = 2048

    bg = Image.new('RGBA', (big, big), BLACK)
    glow = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gr = big * 0.52
    gdraw.ellipse(
        [big / 2 - gr, big * 0.44 - gr * 0.72, big / 2 + gr, big * 0.44 + gr * 0.72],
        fill=GLOW,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(big * 0.14))
    bg = Image.alpha_composite(bg, glow)

    bird = vulture_canvas(big)
    return Image.alpha_composite(bg, bird).resize((size, size), Image.LANCZOS)


def save_png(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    print('wrote', path, img.size)


def main():
    icon = render_icon(1024)
    save_png(icon, f'{ASSETS}/icon.png')
    save_png(icon.resize((192, 192), Image.LANCZOS), f'{PUBLIC}/icon-192.png')
    save_png(icon.resize((512, 512), Image.LANCZOS), f'{PUBLIC}/icon-512.png')
    save_png(icon.resize((180, 180), Image.LANCZOS), f'{PUBLIC}/apple-touch-icon.png')
    save_png(icon.resize((48, 48), Image.LANCZOS), f'{ASSETS}/favicon.png')

    big = 2048
    bird = vulture_canvas(big)
    foreground = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    foreground = Image.alpha_composite(foreground, bird)
    save_png(foreground.resize((1024, 1024), Image.LANCZOS), f'{ASSETS}/adaptive-icon.png')

    mask_bg = Image.new('RGBA', (big, big), BLACK)
    scaled = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    rw = rh = int(big * 0.80)
    small = bird.resize((rw, rh), Image.LANCZOS)
    scaled.paste(small, ((big - rw) // 2, (big - rh) // 2), small)
    maskable = Image.alpha_composite(mask_bg, scaled).resize((512, 512), Image.LANCZOS)
    save_png(maskable, f'{PUBLIC}/icon-maskable-512.png')

    mark = vulture_canvas(512)
    save_png(mark.resize((96, 96), Image.LANCZOS), f'{ASSETS}/vulture-mark.png')


if __name__ == '__main__':
    main()