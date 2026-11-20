"""Separate the original logo board into clean, transparent website assets."""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

board = Image.open(sys.argv[1]).convert("RGB")
board = board.resize((1672, 941), Image.Resampling.LANCZOS)
destination = Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)

bounds = {
    "primary": (72, 184, 1603, 386),
    "secondary": (245, 632, 728, 865),
    "icon": (1147, 650, 1451, 834),
}

for name, crop in bounds.items():
    rgb = np.array(board.crop(crop)).astype(float)
    red, green, blue = np.moveaxis(rgb, 2, 0)
    # The dark board has a blue undertone. Both ink colours are much brighter.
    alpha = np.clip((np.maximum.reduce((red, green, blue)) - 25) / 205, 0, 1)
    alpha[alpha < 0.025] = 0
    matte = np.array([13, 17, 20])
    unblended = np.clip(
        (rgb - matte * (1 - alpha[..., None])) / np.maximum(alpha[..., None], 0.03),
        0,
        255,
    )
    rgba = np.dstack((unblended, alpha * 255)).astype(np.uint8)
    image = Image.fromarray(rgba, "RGBA")
    image = image.crop(image.getbbox())
    if name == "primary":
        image.thumbnail((920, 104), Image.Resampling.LANCZOS)
    image.save(destination / f"{name}.png", optimize=True)
    if name == "icon":
        mark = image.copy()
        mark.thumbnail((106, 88), Image.Resampling.LANCZOS)
        favicon = Image.new("RGBA", (128, 128), (13, 17, 20, 255))
        favicon.alpha_composite(mark, ((128 - mark.width) // 2, (128 - mark.height) // 2))
        favicon.save(destination / "favicon.png", optimize=True)
