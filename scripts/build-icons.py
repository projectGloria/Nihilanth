"""Regenerate matching SVG, PNG and icon-font assets (pip install fonttools pillow)."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'media'
MEDIA.mkdir(exist_ok=True)
# A horned dragon in profile, with an open jaw and a cut-out eye.
OUTLINE = [(3, 1), (9, 5), (15, 2), (14, 7), (18, 9), (19, 11),
           (23, 12), (22, 16), (17, 16), (20, 18), (17, 21),
           (9, 23), (11, 19), (6, 17), (3, 13), (7, 14),
           (5, 10), (1, 7), (7, 8)]
EYE = [(12, 10), (16, 12), (12, 12)]

def svg_path(points):
    return 'M' + ' L'.join(f'{x} {y}' for x, y in points) + ' Z'

(MEDIA / 'dragon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
    '<title>Nihilanth dragon head</title>'
    f'<path fill="#2dd4bf" fill-rule="evenodd" d="{svg_path(OUTLINE)} {svg_path(EYE)}"/>'
    '</svg>\n', encoding='utf-8')

pen = TTGlyphPen(None)
# Font coordinates point upwards. Reverse the eye contour to create a hole.
for contour in (OUTLINE, list(reversed(EYE))):
    points = [(round(x * 1000 / 24), round((24 - y) * 1000 / 24)) for x, y in contour]
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(['.notdef', 'dragon'])
font.setupCharacterMap({0xE001: 'dragon'})
font.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), 'dragon': pen.glyph()})
font.setupHorizontalMetrics({'.notdef': (1000, 0), 'dragon': (1000, 42)})
font.setupHorizontalHeader(ascent=1000, descent=0)
font.setupNameTable({'familyName': 'Nihilanth Icons', 'styleName': 'Regular',
                    'uniqueFontIdentifier': 'NihilanthIcons-Regular',
                    'fullName': 'Nihilanth Icons', 'psName': 'NihilanthIcons-Regular',
                    'version': 'Version 1.0'})
font.setupOS2(sTypoAscender=1000, sTypoDescender=0, usWinAscent=1000, usWinDescent=0)
font.setupPost()
font.setupMaxp()
font.save(MEDIA / 'nihilanth-icons.ttf')

# Supersample the same geometry for a crisp extension-list icon.
SCALE = 4
size = 256 * SCALE
image = Image.new('RGBA', (size, size))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=52 * SCALE, fill='#10252e')
mask = Image.new('L', (size, size))
md = ImageDraw.Draw(mask)
coords = lambda points: [((32 + x * 8) * SCALE, (32 + y * 8) * SCALE) for x, y in points]
md.polygon(coords(OUTLINE), fill=255)
md.polygon(coords(EYE), fill=0)
color = Image.new('RGBA', (size, size))
cd = ImageDraw.Draw(color)
for y in range(size):
    ratio = y / size
    cd.line((0, y, size, y), fill=(int(71 - 38 * ratio), int(232 - 45 * ratio), int(204 - 17 * ratio), 255))
image.paste(color, (0, 0), mask)
image.resize((256, 256), Image.Resampling.LANCZOS).save(MEDIA / 'icon.png')
