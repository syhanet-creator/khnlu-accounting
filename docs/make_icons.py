from PIL import Image, ImageDraw, ImageFont
import os

OUT = "C:/Users/syhanet/Documents/khnp-accounting/icons"
os.makedirs(OUT, exist_ok=True)
NAVY = (13, 13, 13, 255)      # 새 디자인: 검정
GOLD = (16, 163, 127, 255)      # 포인트 녹색
WHITE = (255, 255, 255, 255)
FONT = "C:/Windows/Fonts/malgunbd.ttf"


def draw_icon(size, maskable):
    """maskable: 가장자리가 잘려도 되도록 꽉 채우고 글자는 안쪽 안전 영역(약 60%)에 둔다."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill=NAVY)
        scale = 0.31
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=NAVY)
        scale = 0.37
    font = ImageFont.truetype(FONT, int(size * scale))
    text = "회계"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (size - w) / 2 - box[0]
    y = (size - h) / 2 - box[1] - size * 0.05
    d.text((x, y), text, font=font, fill=WHITE)
    # 글자 아래 금색 막대(장부의 밑줄)
    bar_w, bar_h = w * 0.78, max(4, int(size * 0.035))
    bx = (size - bar_w) / 2
    by = y + box[1] + h + size * 0.06
    d.rounded_rectangle([bx, by, bx + bar_w, by + bar_h], radius=bar_h // 2, fill=GOLD)
    return img


for size, name, maskable in [(192, "icon-192.png", False), (512, "icon-512.png", False), (512, "icon-maskable-512.png", True)]:
    draw_icon(size, maskable).save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)
