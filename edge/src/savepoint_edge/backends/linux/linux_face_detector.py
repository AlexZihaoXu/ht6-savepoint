"""Real face detection + embedding via ONNX Runtime.

detect() implements the standard InsightFace SCRFD "bnkps" decode (see
github.com/deepinsight/insightface/blob/master/detection/scrfd/tools/scrfd.py) —
score threshold -> distance2bbox/kps decode against per-stride anchor
centers -> greedy NMS. This is NOT speculative: it was written against a
real det_2.5g.onnx (SCRFD 2.5G, strides 8/16/32, 2 anchors/location) run on
real Pi 5 hardware, whose 9 output shapes (12800/3200/800 x {1,4,10}) were
confirmed empirically to match this exact reference convention before this
code was written.

Each surviving detection's 5 keypoints are then used to align the face to
the standard 112x112 ArcFace template (Umeyama similarity transform — same
math skimage.transform.SimilarityTransform uses internally, reimplemented
here in plain numpy so this module doesn't need scikit-image) and run
through w600k_mbf.onnx (MobileFaceNet/ArcFace embedding, confirmed via its
ONNX graph to take a 112x112x3 input and emit a 512-d vector — see
FACE_EMBEDDING_DIM in types.py) to produce the real, L2-normalized
`DetectedFace.embedding`.
"""

from __future__ import annotations

import os

import numpy as np
import onnxruntime as ort
from PIL import Image

from savepoint_edge.types import FACE_EMBEDDING_DIM, DetectedFace, Frame

_STRIDES = (8, 16, 32)
_NUM_ANCHORS = 2
# insightface's own SCRFD reference ships det_thresh=0.5 as its default —
# 0.5 is not a coding error — but that default is documented (e.g.
# SthPhoenix/InsightFace-REST#41) to be too strict for small/off-angle/
# dim-lit faces, worse on the lightweight 2.5G variant used here than on
# the bigger 10G model; 0.2-0.3 is the commonly cited practical fix,
# trading some false positives for the recall a wearable capturing casual,
# off-axis conversation actually needs.
_SCORE_THRESHOLD = 0.3
_NMS_THRESHOLD = 0.4

# Minimum face size, as a fraction of frame width, to keep a detection.
# Lowering the score threshold to 0.3 (above) buys recall on the person
# you're actually facing — who is close, and so LARGE in frame — but it
# also lets in the swarm of tiny, distant *background* people a wearable
# picks up in a busy room (verified on real footage: those were all real
# faces, ~40-70px / 3-5% of a 1280px frame, i.e. people across the room,
# not who you're talking to). This is the complementary filter: it's a
# distance/size gate, NOT a confidence gate, so it drops far-away
# bystanders while KEEPING the close person even when they turn or the
# light dims (a low score the 0.3 threshold deliberately preserves). A
# close conversational face is 150px+ (>12% of frame); background faces sit
# well under this. Applied before the embedding step, so rejected faces
# also cost no embedding compute. Override via SAVEPOINT_EDGE_MIN_FACE_FRAC.
_MIN_FACE_FRACTION = float(os.environ.get("SAVEPOINT_EDGE_MIN_FACE_FRAC", "0.06"))
# Standard SCRFD preprocessing constants (same across the 500m/2.5g/10g
# zoo) — see insightface's scrfd.py `prepare()`.
_DET_INPUT_MEAN = 127.5
_DET_INPUT_STD = 128.0

# SCRFD runs on a downscaled copy of the frame, not the full-resolution
# capture — detection cost scales with input pixel count (measured: ~320ms
# at 1280x960 vs ~77ms at 640x480 on Pi 5 for det_2.5g.onnx), while the
# embedding step's cost is FIXED regardless of source resolution (it always
# resizes its aligned crop to 112x112 — measured ~21ms/face either way).
# So detection gets the cheap low-res pass for locating faces, and the
# embedding crop is still sourced from the full-resolution `rgb` array
# (keypoints are scaled back up before alignment) — this keeps embedding
# quality at full resolution while keeping detection latency at the
# 640x480 cost, instead of paying the 1280x960 cost for both.
_DET_INPUT_SIZE = (640, 480)

# Standard ArcFace 112x112 alignment template (5 points: left eye, right
# eye, nose tip, left mouth corner, right mouth corner) — see insightface's
# face_align.py `arcface_dst`. Every ArcFace/MobileFaceNet-family embedding
# model in the insightface zoo, including w600k_mbf, expects faces aligned
# to exactly this template.
_ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)
_EMBED_SIZE = 112
_EMBED_INPUT_MEAN = 127.5
_EMBED_INPUT_STD = 127.5


class LinuxFaceDetector:
    def __init__(self, model_path: str, embed_model_path: str) -> None:
        if not model_path:
            raise ValueError(
                "SAVEPOINT_EDGE_FACE_MODEL is not set — point it at an .onnx file "
                "(see this module's docstring)."
            )
        if not embed_model_path:
            raise ValueError(
                "SAVEPOINT_EDGE_FACE_EMBED_MODEL is not set — point it at an ArcFace/"
                "MobileFaceNet .onnx file, e.g. w600k_mbf.onnx (see this module's docstring)."
            )
        self._session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name
        self._output_names = [o.name for o in self._session.get_outputs()]

        self._embed_session = ort.InferenceSession(
            embed_model_path, providers=["CPUExecutionProvider"]
        )
        self._embed_input_name = self._embed_session.get_inputs()[0].name

    def detect(self, frame: Frame) -> list[DetectedFace]:
        height, width = frame.height, frame.width
        arr = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(height, width, 3)
        # LinuxCamera's "RGB888" picamera2 format is actually BGR-ordered
        # (see that module's docstring) — flip to true RGB, which is what
        # these models were trained/exported against.
        rgb = arr[:, :, ::-1]

        det_w, det_h = _DET_INPUT_SIZE
        det_rgb = np.asarray(Image.fromarray(rgb).resize((det_w, det_h), Image.BILINEAR))
        scale_x, scale_y = width / det_w, height / det_h

        blob = ((det_rgb.astype(np.float32) - _DET_INPUT_MEAN) / _DET_INPUT_STD).transpose(
            2, 0, 1
        )[None, ...]

        outputs = self._session.run(self._output_names, {self._input_name: blob})
        scores_by_stride = outputs[0:3]
        bboxes_by_stride = outputs[3:6]
        kps_by_stride = outputs[6:9]

        all_boxes: list[np.ndarray] = []
        all_scores: list[np.ndarray] = []
        all_kps: list[np.ndarray] = []
        for idx, stride in enumerate(_STRIDES):
            scores = scores_by_stride[idx].reshape(-1)
            keep = scores > _SCORE_THRESHOLD
            if not np.any(keep):
                continue

            fm_h, fm_w = det_h // stride, det_w // stride
            xs, ys = np.meshgrid(np.arange(fm_w), np.arange(fm_h))
            centers = (np.stack([xs, ys], axis=-1).astype(np.float32) * stride).reshape(-1, 2)
            centers = np.repeat(centers, _NUM_ANCHORS, axis=0)

            bbox_preds = bboxes_by_stride[idx] * stride
            kps_preds = kps_by_stride[idx] * stride
            cx, bp, kp = centers[keep], bbox_preds[keep], kps_preds[keep]

            x1, y1 = cx[:, 0] - bp[:, 0], cx[:, 1] - bp[:, 1]
            x2, y2 = cx[:, 0] + bp[:, 2], cx[:, 1] + bp[:, 3]
            all_boxes.append(np.stack([x1, y1, x2, y2], axis=-1))
            all_scores.append(scores[keep])

            # 5 (x, y) pairs, each offset from the same anchor center.
            kp_points = kp.reshape(-1, 5, 2) + cx[:, None, :]
            all_kps.append(kp_points.reshape(-1, 10))

        if not all_boxes:
            return []

        # Scale detection-resolution coordinates back up to the full-res
        # frame — everything from here on (NMS, embedding crop, normalized
        # DetectedFace output) operates in full-resolution space.
        boxes = np.concatenate(all_boxes, axis=0)
        boxes[:, [0, 2]] *= scale_x
        boxes[:, [1, 3]] *= scale_y
        scores = np.concatenate(all_scores, axis=0)
        kps = np.concatenate(all_kps, axis=0)
        kps[:, 0::2] *= scale_x
        kps[:, 1::2] *= scale_y

        faces = []
        for i in _nms(boxes, scores, _NMS_THRESHOLD):
            x1, y1, x2, y2 = boxes[i]
            # Clamp both edges independently before computing w/h from the
            # clamped edges — clamping x1/y1 without also re-deriving w/h
            # from the (now-clamped) edges left the box extending past the
            # true right/bottom edge whenever the raw decode ran outside
            # the frame (common for faces near the border).
            x1c, y1c = max(0.0, x1), max(0.0, y1)
            x2c, y2c = min(float(width), x2), min(float(height), y2)
            # Size gate (see _MIN_FACE_FRACTION): use the larger normalized
            # side so a close-but-turned face (narrow but tall) still
            # passes, while genuinely small distant/texture boxes are
            # dropped before the embedding step runs.
            w_norm, h_norm = (x2c - x1c) / width, (y2c - y1c) / height
            if max(w_norm, h_norm) < _MIN_FACE_FRACTION:
                continue
            face_kps = kps[i].reshape(5, 2)
            embedding = self._embed(rgb, face_kps)
            faces.append(
                DetectedFace(
                    x=x1c / width,
                    y=y1c / height,
                    w=(x2c - x1c) / width,
                    h=(y2c - y1c) / height,
                    confidence=float(scores[i]),
                    embedding=embedding,
                )
            )
        return faces

    def _embed(self, rgb: np.ndarray, keypoints: np.ndarray) -> list[float]:
        transform = _umeyama(keypoints, _ARCFACE_DST)
        inv = np.linalg.inv(transform)
        # PIL's AFFINE data maps output coords -> input coords, i.e. the
        # inverse of the src(detection)->dst(template) transform we just
        # estimated.
        coeffs = inv[:2, :].flatten()
        aligned = Image.fromarray(rgb).transform(
            (_EMBED_SIZE, _EMBED_SIZE), Image.AFFINE, coeffs, resample=Image.BILINEAR
        )

        blob = (
            (np.asarray(aligned, dtype=np.float32) - _EMBED_INPUT_MEAN) / _EMBED_INPUT_STD
        ).transpose(2, 0, 1)[None, ...]
        (embedding,) = self._embed_session.run(None, {self._embed_input_name: blob})
        embedding = embedding[0]
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        assert embedding.shape[0] == FACE_EMBEDDING_DIM
        return embedding.tolist()


def _nms(boxes: np.ndarray, scores: np.ndarray, threshold: float) -> list[int]:
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(iou <= threshold)[0] + 1]
    return keep


def _umeyama(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Estimate the similarity transform (scale + rotation + translation)
    mapping `src` points onto `dst` points, least-squares (Umeyama 1991).
    Pure-numpy reimplementation of what skimage.transform.SimilarityTransform
    does internally — avoids adding scikit-image as a dependency just for
    this one call. Returns a 3x3 homogeneous transform matrix."""
    num, dim = src.shape
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_demean = src - src_mean
    dst_demean = dst - dst_mean

    a = dst_demean.T @ src_demean / num
    d = np.ones(dim)
    if np.linalg.det(a) < 0:
        d[dim - 1] = -1

    u, s, vt = np.linalg.svd(a)
    rank = np.linalg.matrix_rank(a)
    t = np.eye(dim + 1, dtype=np.float64)
    if rank == dim - 1:
        if np.linalg.det(u) * np.linalg.det(vt) > 0:
            t[:dim, :dim] = u @ vt
        else:
            s_val = d[dim - 1]
            d[dim - 1] = -1
            t[:dim, :dim] = u @ np.diag(d) @ vt
            d[dim - 1] = s_val
    else:
        t[:dim, :dim] = u @ np.diag(d) @ vt

    scale = 1.0 / src_demean.var(axis=0).sum() * (s @ d)
    t[:dim, dim] = dst_mean - scale * (t[:dim, :dim] @ src_mean)
    t[:dim, :dim] *= scale
    return t
