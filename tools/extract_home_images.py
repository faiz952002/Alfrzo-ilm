"""Cut the home-page images out of the approved mockup (design/home-mockup.png, 942 x 1670).

Text that is printed inside the mockup images (city names, tile labels, banner texts, the menu
and bell icons) is painted out, because the app draws those itself (translated, clickable).
Run:  python3 tools/extract_home_images.py   ->  writes public/img/home/*.jpg
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'design' / 'home-mockup.png', ROOT / 'public' / 'img' / 'home'


def vfill(im, x0, x1, y0, y1):
    """Replace rows y0..y1 by a vertical blend of the rows just above and below."""
    top, bot = im.crop((x0, y0 - 1, x1, y0)), im.crop((x0, y1, x1, y1 + 1))
    for y in range(y0, y1):
        t = (y - y0 + 1) / (y1 - y0 + 1)
        im.paste(Image.blend(top, bot, t), (x0, y))


def hfill(im, x0, x1, y0, y1):
    """Replace columns x0..x1 by a horizontal blend of the columns just left and right."""
    left, right = im.crop((x0 - 1, y0, x0, y1)), im.crop((x1, y0, x1 + 1, y1))
    for x in range(x0, x1):
        t = (x - x0 + 1) / (x1 - x0 + 1)
        im.paste(Image.blend(left, right, t), (x, y0))


def patch(im, box, dx):
    """Cover box with the area dx pixels to the side (plain sky), then soften the edges."""
    x0, y0, x1, y1 = box
    im.paste(im.crop((x0 + dx, y0, x1 + dx, y1)), (x0, y0))
    region = im.crop((x0 - 6, y0 - 6, x1 + 6, y1 + 6)).filter(ImageFilter.GaussianBlur(3))
    im.paste(region, (x0 - 6, y0 - 6))


def save(im, name, q=90):
    im.convert('RGB').save(OUT / name, quality=q, optimize=True, progressive=True)
    print(f'{name:22s} {im.size[0]}x{im.size[1]}')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    m = Image.open(SRC).convert('RGB')
    assert m.size == (942, 1670), m.size

    # hero: below the phone status bar, down to the search bar; remove the drawn menu + bell
    hero = m.copy()
    patch(hero, (30, 92, 98, 146), 74)          # menu icon  -> sky to its right
    patch(hero, (850, 78, 926, 150), -80)       # bell + "3" -> sky to its left
    patch(hero, (40, 18, 150, 62), 120)         # status bar time
    patch(hero, (730, 18, 910, 62), -150)       # status bar signal / wifi / battery
    save(hero.crop((0, 30, 942, 602)), 'hero.jpg', 88)

    # quick topic tiles (label painted out)
    for name, (x0, x1) in {'quran': (61, 202), 'hadith': (231, 369), 'fiqah': (398, 544),
                           'scholars': (573, 722), 'more': (751, 892)}.items():
        t = m.crop((x0, 730, x1, 859)).copy()
        vfill(t, 12, t.width - 12, 88, 124)
        save(t, f'tile-{name}.jpg')

    # popular cities (name painted out)
    for name, (x0, x1) in {'bengaluru': (53, 257), 'hyderabad': (275, 469),
                           'pune': (486, 680), 'mumbai': (697, 891)}.items():
        c = m.crop((x0, 955, x1, 1094)).copy()
        vfill(c, 10, c.width - 10, 100, 131)
        save(c, f'city-{name}.jpg')

    # "Ask a Scholar" banner (title, text and button painted out)
    a = m.crop((35, 1123, 908, 1288)).copy()
    hfill(a, 188, 438, 8, 157)
    save(a, 'ask-banner.jpg')

    # feature tiles (label painted out)
    for name, (x0, x1, lab) in {'chat': (36, 199, 82), 'reels': (219, 375, 82), 'profile': (394, 549, 82),
                                'consult': (568, 724, 82), 'ask': (744, 905, 70)}.items():
        f = m.crop((x0, 1303, x1, 1424)).copy()
        vfill(f, 12, f.width - 12, lab, 116)
        save(f, f'feat-{name}.jpg')

    # closing banner (text painted out, lotus + skyline kept)
    b = m.crop((34, 1441, 908, 1530)).copy()
    hfill(b, 146, 506, 8, 82)
    save(b, 'foot-banner.jpg')


if __name__ == '__main__':
    main()
