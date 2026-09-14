# Extension icons

This directory contains SVG icons and generated PNGs.

After modifications, run the following commands to regenerate the icons:

```sh
rsvg-convert -w 16 -h 16 ocr_icon_small.svg -o 16.png
rsvg-convert -w 32 -h 32 ocr_icon_big.svg -o 32.png
rsvg-convert -w 48 -h 48 ocr_icon_big.svg -o 48.png
rsvg-convert -w 128 -h 128 ocr_icon_big.svg -o 128.png
```
