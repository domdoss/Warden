"""COCO class-name lookup for the eyes detector.

RF-DETR is COCO-trained; class_id 0 = "person". Kept here (next to the
detector) so `detector.py` can do `from .config import class_name`.
"""

from __future__ import annotations

# COCO 80-class names. RF-DETR is COCO-trained; class_id 0 = "person".
COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep",
    "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard",
    "sports ball", "kite", "baseball bat", "baseball glove", "skateboard",
    "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv",
    "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
    "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
]


def class_name(class_id: int | None) -> str | None:
    if class_id is None:
        return None
    if 0 <= class_id < len(COCO_NAMES):
        return COCO_NAMES[class_id]
    return f"class_{class_id}"