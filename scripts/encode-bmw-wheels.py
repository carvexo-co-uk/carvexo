"""Build the matched BMW poster and wheel atlas from the Blender frames."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

source, destination = map(Path, sys.argv[1:3])
patches = [(248, 306, 120, 136, 0), (563, 258, 92, 110, 120)]
atlas = Image.new('RGBA', (8 * 212, 4 * 136))
for index in range(32):
    with Image.open(source / f'wheels-{index:04d}.png') as frame:
        if index == 0:
            frame.convert('RGB').save(destination / 'studio.webp', quality=92, method=6)
        for x, y, width, height, tile_x in patches:
            patch = frame.crop((x, y, x + width, y + height)).convert('RGBA')
            mask = Image.new('L', patch.size)
            ImageDraw.Draw(mask).rectangle((6, 6, width - 7, height - 7), fill=255)
            patch.putalpha(mask.filter(ImageFilter.GaussianBlur(2)))
            atlas.paste(patch, ((index % 8) * 212 + tile_x, (index // 8) * 136))
atlas.save(destination / 'bmw-wheels.webp', quality=91, method=6)
