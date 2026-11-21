import json
import sys

from PIL import Image, ImageChops, ImageFilter, ImageOps


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


source, output = sys.argv[1:]
with Image.open(source) as original:
    image = ImageOps.exif_transpose(original).convert('RGB')
    width, height = image.size
    angle = deskew_angle(image)
    prepared = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor='white') if angle else image
    ocr_width, ocr_height = prepared.size
    scale = 1
    if abs(angle) >= 9:
        prepared = ImageOps.autocontrast(ImageOps.grayscale(prepared))
        if ocr_width < 900:
            scale = 2
            prepared = prepared.resize((ocr_width * scale, ocr_height * scale))
        prepared = prepared.filter(ImageFilter.UnsharpMask(1, 130, 2))
    prepared.save(output)
    print(json.dumps(dict(width=width, height=height, angle=angle, ocrWidth=ocr_width, ocrHeight=ocr_height, scale=scale)))
