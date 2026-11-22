"""Cut the home-page images out of the second approved mockup (design/home-mockup-v2.png, 841 x 1870).

- logo + hero + "Quran & Hadith" banner are used as drawn (their English text stays in the picture;
  the app adds the same text for screen readers and makes the buttons clickable).
- category tiles: the printed label is painted out; the app draws the label (Hindi / English).
- the "Our Scholars" photos in the mockup show real public figures; they are NOT used. The app shows
  the verified scholars from the database instead.
Run:  python3 tools/extract_home_v2_images.py   ->  writes public/img/home2/*.jpg
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'design' / 'home-mockup-v2.png', ROOT / 'public' / 'img' / 'home2'


def vfill(im, x0, x1, y0, y1):
    """Replace rows y0..y1 by a vertical blend of the rows just above and below."""
    top, bot = im.crop((x0, y0 - 1, x1, y0)), im.crop((x0, y1, x1, y1 + 1))
    for y in range(y0, y1):
        t = (y - y0 + 1) / (y1 - y0 + 1)
        im.paste(Image.blend(top, bot, t), (x0, y))
    band = im.crop((x0, y0 - 2, x1, y1 + 1)).filter(ImageFilter.BoxBlur(3))   # soften the streaks
    im.paste(band.crop((3, 0, band.width - 3, band.height)), (x0 + 3, y0 - 2))


def save(im, name, q=88):
    im.convert('RGB').save(OUT / name, quality=q, optimize=True, progressive=True)
    print(f'{name:22s} {im.size[0]}x{im.size[1]}')


TILES = ['aqeedah', 'namaz', 'roza', 'zakat', 'nikah', 'family', 'hajj', 'akhlaq', 'quran', 'more']
COLS = [(25, 170), (191, 335), (357, 500), (521, 664), (685, 817)]
ROWS = [(848, 981, 92, 128), (1003, 1133, 88, 124)]   # y0, y1, label from, label to (inside the tile)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    m = Image.open(SRC).convert('RGB')
    assert m.size == (841, 1870), m.size

    save(m.crop((214, 56, 322, 168)), 'logo.jpg', 92)            # gold mosque logo
    logo = m.crop((214, 56, 322, 168)).convert('RGBA')            # same logo, navy background made transparent
    px = logo.load()
    for y in range(logo.height):
        for x in range(logo.width):
            r, g, b, _ = px[x, y]
            a = max(0, min(255, int((r - 45) * 255 / 110)))         # gold/white strokes are bright red-ish; navy is not
            px[x, y] = (r, g, b, a)
    logo.save(OUT / 'logo.png', optimize=True)
    print('logo.png               transparent')
    save(m.crop((0, 180, 841, 652)), 'hero.jpg', 86)              # hero with its quote + "Explore Now"
    save(m.crop((6, 1440, 836, 1652)), 'banner-quran.jpg', 86)    # "Quran & Hadith" banner

    for i, name in enumerate(TILES):
        y0, y1, l0, l1 = ROWS[i // 5]
        x0, x1 = COLS[i % 5]
        t = m.crop((x0, y0, x1, y1)).copy()
        if name == 'more':          # keep the three dots, remove the word
            vfill(t, 10, t.width - 10, l0 + 2, l1)
        else:
            vfill(t, 10, t.width - 10, l0, l1)
        save(t, f'cat-{name}.jpg')


if __name__ == '__main__':
    main()
