import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps


def connected_regions(mask):
    width, height = mask.size
    # Close gaps from printed text, then open narrow joins between sheets.
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(7))
    pixels = bytearray(mask.tobytes())
    boxes = []
    for start in range(len(pixels)):
        if not pixels[start]:
            continue
        pixels[start] = 0
        component = [start]
        left, top, right, bottom = width, height, 0, 0
        for index in component:
            y, x = divmod(index, width)
            left, top, right, bottom = min(left, x), min(top, y), max(right, x), max(bottom, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and pixels[ny * width + nx]:
                    pixels[ny * width + nx] = 0
                    component.append(ny * width + nx)
        area = (right - left + 1) * (bottom - top + 1)
        if len(component) >= width * height * 0.04 and len(component) >= area * 0.65:
            boxes.append((left, top, right + 1, bottom + 1))
    return boxes


def paper_regions(image):
    preview = image.copy()
    preview.thumbnail((330, 330))
    width, height = preview.size
    mask = Image.new('L', preview.size)
    mask.putdata([255 if green >= 95 and red - blue < 0.16 * red else 0
                  for red, green, blue in preview.getdata()])
    boxes = connected_regions(mask)
    if len(boxes) < 2:
        grayscale = ImageOps.autocontrast(ImageOps.grayscale(preview), cutoff=10)
        boxes = connected_regions(grayscale.point(lambda value: 255 if value >= 170 else 0))

    if len(boxes) < 2:
        return []
    if len(boxes) > 6 or any(
        a < x2 and c > x1 and b < y2 and d > y1
        for index, (a, b, c, d) in enumerate(boxes) for x1, y1, x2, y2 in boxes[index + 1:]
    ):
        return None
    return [(max(0, left - 1) * image.width // width, max(0, top - 1) * image.height // height,
             min(width, right + 1) * image.width // width, min(height, bottom + 1) * image.height // height)
            for left, top, right, bottom in sorted(boxes, key=lambda box: (box[1], box[0]))]


def deskew_angle(image):
    preview = ImageOps.grayscale(image)
    preview.thumbnail((330, 330))
    width, height = preview.size
    strokes = ImageChops.subtract(preview.filter(ImageFilter.GaussianBlur(3)), preview)
    strokes = strokes.point(lambda value: 1 if value >= 23 else 0)

    def score(angle):
        center = strokes.rotate(angle).crop((width // 6, height // 7, width - width // 6, height - height // 6))
        pixels = center.tobytes()
        rows = [min(sum(pixels[index:index + center.width]), center.width // 3)
                for index in range(0, len(pixels), center.width)]
        return sum((first - second) ** 2 for first, second in zip(rows, rows[1:])) / max(1, sum(rows))

    angle, peak = max(((angle, score(angle)) for angle in range(-36, 37, 3)), key=lambda sample: sample[1])
    return angle if peak >= 2.5 and peak >= 1.45 * score(0) else 0


def save_candidates(image, output, index):
    angle = deskew_angle(image)
    variations = [(angle, False)]
    if abs(angle) >= 9:
        variations.extend([(angle - 1, True), (angle + 1, True)])
    results = []
    for variant, (angle, focused) in enumerate(variations):
        prepared = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor='white') if angle else image
        width, height = prepared.size
        x, y = 0, 0
        scale = 1
        if focused:
            x, y = round(width * 0.18), round(height * 0.20)
            prepared = prepared.crop((x, y, round(width * 0.79), round(height * 0.75)))
        if abs(angle) >= 9:
            prepared = ImageOps.autocontrast(ImageOps.grayscale(prepared))
            if prepared.width < 900:
                scale = 2
                prepared = prepared.resize((prepared.width * scale, prepared.height * scale))
            prepared = prepared.filter(ImageFilter.UnsharpMask(1, 130, 2))
        filename = f'{index}-{variant}.png'
        prepared.save(Path(output) / filename)
        results.append(dict(filename=filename, angle=angle, width=width, height=height, x=x, y=y, scale=scale))
    return results


if sys.argv[1] == '--fiscal-columns':
    _, source, output = sys.argv[1:]
    with Image.open(source) as image:
        gray = ImageOps.grayscale(image)
        contrast = ImageChops.subtract(gray, gray.filter(ImageFilter.GaussianBlur(12)), offset=180)
        contrast = ImageOps.autocontrast(contrast, cutoff=0.3).point(lambda value: 255 if value >= 197 else value)
        split = round(image.width * 0.56)
        bottom = round(image.height * 0.568)
        contrast.crop((0, 0, round(image.width * 0.573), bottom)).save(Path(output) / 'fiscal-labels.png')
        contrast.crop((split, 0, round(image.width * 0.981), bottom)).save(Path(output) / 'fiscal-amounts.png')
        print(split)
    sys.exit(0)


source, output = sys.argv[1:]
with Image.open(source) as original:
    upright = ImageOps.exif_transpose(original).convert('RGB')
    boxes = paper_regions(upright)
    regions = boxes or [(0, 0, upright.width, upright.height)]
    candidates = [save_candidates(upright.crop(box), output, index) for index, box in enumerate(regions)]
    print(json.dumps({'regions': regions, 'candidates': candidates, 'ambiguous': boxes is None}))
