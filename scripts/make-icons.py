# Draws the Balance mark (a "B" in spending-grid squares) into the app icon and splash assets.
# Usage: python3 scripts/make-icons.py assets/images [flat|heat]
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
variant = sys.argv[2] if len(sys.argv) > 2 else 'flat'
BG = (0x1A, 0x16, 0x14, 255)
HEAT = ['#2B2420', '#5C2D1C', '#93401F', '#D2582B', '#FF7444']
# A "B" drawn in heat squares, 4 wide x 5 tall. Empty cells keep the no-spend shade so it still reads as the grid.
B = ['###.',
     '#..#',
     '###.',
     '#..#',
     '###.']
if variant == 'heat':
    # Spine brightest, bowls a step down: the letter shades like a busy week.
    LEVELS = [[4, 4, 3, 0], [4, 0, 0, 3], [4, 4, 3, 0], [4, 0, 0, 3], [4, 4, 3, 0]]
else:
    LEVELS = [[4 if c == '#' else 0 for c in row] for row in B]
ROWS, COLS = len(LEVELS), len(LEVELS[0])
SS = 4

def hexrgba(h, a=255):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (a,)

def mark(canvas, mark_h, bg=None, mono=False):
    """Grid centered in a square canvas; mark_h = grid height in px."""
    S = canvas * SS
    img = Image.new('RGBA', (S, S), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    h = mark_h * SS
    gap_ratio = 0.16
    cell = h / (ROWS + (ROWS - 1) * gap_ratio)
    gap = cell * gap_ratio
    w = COLS * cell + (COLS - 1) * gap
    x0, y0 = (S - w) / 2, (S - h) / 2
    r = cell * 0.26
    for row in range(ROWS):
        for col in range(COLS):
            lvl = LEVELS[row][col]
            if mono:
                if lvl == 0:
                    continue  # themed icons: just the letter
                fill = (255, 255, 255, 255)
            else:
                fill = hexrgba(HEAT[lvl])
            x = x0 + col * (cell + gap)
            y = y0 + row * (cell + gap)
            d.rounded_rectangle([x, y, x + cell, y + cell], radius=r, fill=fill)
    return img.resize((canvas, canvas), Image.LANCZOS)

mark(1024, 600, bg=BG).save(f'{out}/icon.png')
# Adaptive: launchers show roughly the middle 2/3 of the canvas, so keep the grid inside ~480px.
mark(1024, 440).save(f'{out}/android-icon-foreground.png')
Image.new('RGBA', (1024, 1024), BG).save(f'{out}/android-icon-background.png')
mark(1024, 440, mono=True).save(f'{out}/android-icon-monochrome.png')
mark(512, 512).save(f'{out}/splash-icon.png')
