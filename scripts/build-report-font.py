"""Build pinned report webfonts from an OFL Noto Serif SC variable TTF.

Usage: python scripts/build-report-font.py /path/to/NotoSerifSC-VF.ttf
Requires fonttools and brotli. The generated fonts are committed; not a build dependency.
"""
import copy
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

output = Path(__file__).resolve().parents[1] / 'public' / 'fonts'
output.mkdir(exist_ok=True)
font = TTFont(sys.argv[1])
# GB2312 includes 6,763 common Han characters. Keep Latin, Greek, math and
# punctuation for scholarly prose; rarer characters use the CSS serif fallback.
characters = set(range(0x20, 0x250)) | set(range(0x370, 0x400))
for start, end in [(0x2000, 0x2070), (0x2100, 0x2300), (0x3000, 0x3040), (0xff00, 0xfff0)]:
    characters.update(range(start, end))
for high in range(0xa1, 0xf8):
    for low in range(0xa1, 0xff):
        try:
            characters.add(ord(bytes([high, low]).decode('gb2312')))
        except UnicodeDecodeError:
            pass
options = subset.Options()
options.name_IDs = ['*']
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=characters)
subsetter.subset(font)
for weight in [400, 700]:
    face = instantiateVariableFont(copy.deepcopy(font), {'wght': weight}, inplace=True)
    # Unique static face names prevent platform font caches resolving both
    # instances to the source variable font's ExtraLight PostScript identity.
    style = 'Bold' if weight == 700 else 'Regular'
    for name_id, value in {1: 'Report Serif', 2: style, 3: f'ReportSerif-{style}',
                           4: f'Report Serif {style}', 6: f'ReportSerif-{style}',
                           16: 'Report Serif', 17: style}.items():
        face['name'].removeNames(nameID=name_id)
        face['name'].setName(value, name_id, 3, 1, 0x409)
    face['OS/2'].fsSelection = (face['OS/2'].fsSelection & ~0x60) | (0x20 if weight == 700 else 0x40)
    face['head'].macStyle = (face['head'].macStyle & ~1) | (1 if weight == 700 else 0)
    face.flavor = 'woff2'
    target = output / f'report-serif-{weight}.woff2'
    face.save(target)
    print(f'{target.name}: {target.stat().st_size} bytes')
