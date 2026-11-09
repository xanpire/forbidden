# Draws frbddn's icons: a red keyhole on near-black with a soft red glow. Also a plain "Notes" icon for the
# neutral-name option. Run: python3 scripts/make-icon.py
from PIL import Image, ImageDraw, ImageFilter

BLACK = (5, 5, 5, 255)
RED = (229, 9, 20, 255)


def mark(size, padding=0.0, rounded=False):
    img = Image.new('RGBA', (size, size), BLACK)
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    r = size * 0.34
    g.ellipse((size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r), fill=(120, 6, 14, 150))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size * 0.12)))
    # A keyhole: a circle over a flared slot.
    d = ImageDraw.Draw(img)
    scale = 1 - padding
    c = size / 2
    r = size * 0.13 * scale
    top = c - size * 0.12 * scale
    d.ellipse((c - r, top - r, c + r, top + r), fill=RED)
    d.polygon(
        [
            (c - r * 0.42, top + r * 0.3),
            (c + r * 0.42, top + r * 0.3),
            (c + r * 0.95, c + size * 0.24 * scale),
            (c - r * 0.95, c + size * 0.24 * scale),
        ],
        fill=RED,
    )
    if rounded:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img


def neutral(size):
    img = Image.new('RGBA', (size, size), (236, 236, 232, 255))
    d = ImageDraw.Draw(img)
    for i in range(4):
        y = size * (0.3 + i * 0.13)
        d.rounded_rectangle((size * 0.22, y, size * (0.78 if i < 3 else 0.55), y + size * 0.05), radius=size * 0.02, fill=(150, 150, 146, 255))
    return img


mark(1024).save('assets/images/icon.png')
mark(1024, padding=0.22).save('assets/images/adaptive-icon.png')
mark(48).save('assets/images/favicon.png')
mark(192).save('public/icon-192.png')
mark(512).save('public/icon-512.png')
mark(512, padding=0.2).save('public/icon-maskable-512.png')
mark(180).save('public/apple-touch-icon.png')
neutral(48).save('public/favicon-neutral.png')
neutral(180).save('public/icon-neutral-180.png')
print('icons written')
