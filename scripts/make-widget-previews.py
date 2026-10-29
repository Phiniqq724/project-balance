# Draws the widget picker previews with sample numbers, mirroring src/widgets/*.tsx.
# Usage: python3 scripts/make-widget-previews.py assets/widget-previews
import random
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
S = 3  # Drawn at xxhdpi; Android scales drawable-nodpi to the picker cell.
BG = '#1A1614'
TEXT = '#F3EBE2'
MUTED = '#AC9F92'
ACCENT = '#9BCB9F'
HEAT = ['#2B2420', '#5C2D1C', '#93401F', '#D2582B', '#FF7444']
FONTS = 'assets/fonts/Satoshi-{}.otf'


def font(weight, size):
    return ImageFont.truetype(FONTS.format(weight), size * S)


def canvas(w, h):
    img = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, w * S - 1, h * S - 1), radius=20 * S, fill=BG)
    return img, draw


def text(draw, x, y, value, weight, size, fill):
    """Draws with the top of the line box at y (dp) and returns the x after it."""
    f = font(weight, size)
    draw.text((x * S, y * S), value, font=f, fill=fill)
    return x + draw.textlength(value, font=f) / S


def spend_grid(w, h, pad, header, name, draw_header):
    gap_ratio = 0.25
    img, draw = canvas(w, h)
    draw_header(draw, pad)

    # Same sizing as WidgetBridge.gridArea / spendGridProps.
    area_w, area_h = w - 2 * pad, h - 2 * pad - header
    unit = area_h / (7 + 6 * gap_ratio)
    weeks = int((area_w + unit * gap_ratio) / (unit * (1 + gap_ratio)))
    gap = unit * gap_ratio
    top = h - pad - area_h
    random.seed(7)
    today = weeks * 7 - 3  # A Friday: the rest of this week is still empty.
    for i in range(today + 1):
        roll = random.random()
        level = 0 if roll < 0.28 else 1 if roll < 0.5 else 2 if roll < 0.72 else 3 if roll < 0.9 else 4
        cx = pad + (i // 7) * (unit + gap)
        cy = top + (i % 7) * (unit + gap)
        draw.rounded_rectangle(
            (cx * S, cy * S, (cx + unit) * S, (cy + unit) * S), radius=unit * 0.22 * S, fill=HEAT[level]
        )
    img.save(f'{out}/{name}.png')


def big_header(draw, pad):
    x = text(draw, pad, pad, '2.84M', 'Bold', 15, TEXT)
    text(draw, x, pad + 2, ' in 19 weeks  ·  45K today', 'Regular', 13, MUTED)


def small_header(draw, pad):
    x = text(draw, pad, pad, '45K', 'Bold', 15, TEXT)
    text(draw, x, pad + 2, ' today', 'Regular', 13, MUTED)


def month_pulse():
    w, h, pad = 150, 160, 14
    img, draw = canvas(w, h)
    y = pad
    text(draw, pad, y, 'October', 'Regular', 12, MUTED)
    y += 16 + 6
    text(draw, pad, y, '4.2M', 'Bold', 28, TEXT)
    y += 36
    text(draw, pad, y, 'spent', 'Regular', 12, MUTED)
    y += 16 + 10
    text(draw, pad, y, '+8.5M in', 'Medium', 13, ACCENT)
    y += 18
    text(draw, pad, y, '120K today', 'Regular', 13, MUTED)
    img.save(f'{out}/month_pulse.png')


# The picker shows the 2x2 it's added at; stretched wide it switches to big_header.
spend_grid(150, 150, 14, 28, 'spend_grid', small_header)
month_pulse()
