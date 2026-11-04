# Draws the widget picker previews with sample numbers, mirroring src/widgets/*.tsx.
# Usage: python3 scripts/make-widget-previews.py assets/widget-previews
import math
import random
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
S = 3  # Drawn at xxhdpi; Android scales drawable-nodpi to the picker cell.
BG = '#1A1614'
TEXT = '#F3EBE2'
MUTED = '#AC9F92'
LINE = '#3A322C'
EMBER = '#FF7444'
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


def smooth(points, steps=10):
    """Catmull-Rom-ish smoothing, clamped so it never dips below the lower neighbour (like the monotone curve)."""
    out = []
    for i in range(len(points) - 1):
        p0, p1 = points[i], points[i + 1]
        for k in range(steps):
            t = k / steps
            e = (1 - math.cos(math.pi * t)) / 2
            out.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * e))
    out.append(points[-1])
    return out


def daily_spend():
    w, h, pad, header = 250, 110, 12, 24
    img, draw = canvas(w, h)
    x = text(draw, pad, pad, '2.84M', 'Bold', 15, TEXT)
    text(draw, x, pad + 2, ' in 30d', 'Regular', 13, MUTED)
    cw, ch = w - 2 * pad, h - 2 * pad - header
    left, top = pad, pad + header
    days = 30
    vals = [0.18, 0.3, 0.12, 0.22, 0.5, 0.16, 0.1, 0.28, 0.2, 0.62, 0.14, 0.24, 0.18, 0.1, 0.36, 0.8, 0.2, 0.3,
            0.26, 0.12, 0.44, 0.2, 0.1, 0.34, 0.56, 0.16, 0.22, 0.3, 0.14, 0.4]
    pts = [(left + (i + 0.5) * cw / days, top + 2 + (1 - v) * (ch - 4)) for i, v in enumerate(vals)]
    for yy in (top + 2, top + ch - 2):
        draw.line((left * S, yy * S, (left + cw) * S, yy * S), fill=LINE, width=S)
    text(draw, left, top + 6, '500K', 'Medium', 10, MUTED)
    curve = smooth(pts)
    fill = Image.new('RGBA', img.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(fill)
    base = (top + ch - 2) * S
    for a, b in zip(curve, curve[1:]):
        fd.polygon([(a[0] * S, a[1] * S), (b[0] * S, b[1] * S), (b[0] * S, base), (a[0] * S, base)], fill=(243, 235, 226, 28))
    img.alpha_composite(fill)
    draw = ImageDraw.Draw(img)
    draw.line([(px * S, py * S) for px, py in curve], fill=TEXT, width=2 * S, joint='curve')
    lx, ly = pts[-1]
    draw.ellipse(((lx - 3.5) * S, (ly - 3.5) * S, (lx + 3.5) * S, (ly + 3.5) * S), fill=EMBER)
    img.save(f'{out}/daily_spend.png')


def day_by_day():
    w, h, pad, header = 110, 110, 12, 24
    img, draw = canvas(w, h)
    x = text(draw, pad, pad, '640K', 'Bold', 15, TEXT)
    text(draw, x, pad + 2, ' in 7d', 'Regular', 13, MUTED)
    cw, ch = w - 2 * pad, h - 2 * pad - header
    top = pad + header
    base = top + ch - 10 - 6
    slot = cw / 7
    bw = min(slot * 0.62, 14)
    vals = [0.5, 0.2, 0.85, 0, 0.35, 0.6, 0.45]
    for i, (v, d) in enumerate(zip(vals, 'WTFSSMT')):
        cx = pad + (i + 0.5) * slot
        last = i == 6
        color = LINE if v == 0 else EMBER if last else '#6D645B'
        bh = 2 if v == 0 else max(v * (base - top - 2), 2)
        draw.rounded_rectangle(
            ((cx - bw / 2) * S, (base - bh) * S, (cx + bw / 2) * S, base * S), radius=min(bw / 2, 3) * S, fill=color
        )
        f = font('Medium', 10)
        tw = draw.textlength(d, font=f) / S
        draw.text(((cx - tw / 2) * S, (base + 5) * S), d, font=f, fill=TEXT if last else MUTED)
    img.save(f'{out}/day_by_day.png')


# The picker shows the 2x2 it's added at; stretched wide it switches to big_header.
spend_grid(150, 150, 14, 28, 'spend_grid', small_header)
month_pulse()
daily_spend()
day_by_day()
