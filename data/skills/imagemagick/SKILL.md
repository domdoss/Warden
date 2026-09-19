---
name: imagemagick
description: "Inspect, convert, resize, crop, rotate, batch, and compose images with ImageMagick (magick/convert, identify, mogrify). Use for any image-processing task: format conversion, thumbnails, watermarks, contact sheets, bulk folder resizing."
---

## Inspect first
- `identify <file>` — dimensions, format, size, colorspace. `identify -format '%wx%h %b' <file>` for a compact one-liner. Always read before transforming.

## Single image (magick)
- Convert format: `magick in.png out.jpg` (add `-quality 90` for jpeg).
- Resize: `magick in.png -resize 1920x1080 out.png`. Exact size ignoring aspect: `-resize 1920x1080!`. Percentage: `-resize 50%`. Thumbnail (fast, strips metadata): `-thumbnail 400x400`.
- Crop: `-crop 800x600+100+50` (WxH+X+Y). Rotate: `-rotate 90`. Flip: `-flop` (horizontal).
- Grayscale: `-colorspace Gray`. Sharpen: `-sharpen 0x1`. Level/contrast: `-auto-level`, `-normalize`.
- Strip EXIF/metadata: `-strip`.
- Composite one image over another: `magick bg.png overlay.png -gravity southeast -geometry +10+10 -composite out.png`. Watermark text: `-gravity southeast -fill white -annotate +10+10 'text'`.

## Whole folder (mogrify — edits in place)
- Resize every jpg in the cwd: `mogrify -resize 1600x -path resized/ *.jpg` (`-path` writes copies to a subfolder; without it files are overwritten).
- Convert all to png: `mogrify -format png *.webp`.
- Batch to separate outputs per file: a `Bash` for-loop with `magick` is fine too — one call, sequential files.

## Contact sheet / montage
- `montage *.jpg -tile 5x -geometry 200x200+4+4 sheet.png` — grid of thumbnails, one file.

## Rules
- Prefer `magick` (IM7) spelling; if the binary is IM6, `convert` is the same syntax.
- Confirm the output with `identify` (dimensions) before reporting done.
- Overwrites are permanent — use `-path`/distinct output names when a folder job might need the originals.