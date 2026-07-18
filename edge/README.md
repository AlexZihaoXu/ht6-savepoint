# edge/ — Pi 5 + QNX IO-source capture

**Status: placeholder.** This directory will hold the on-device capture code that runs on
the **Raspberry Pi 5 under QNX** — the "it runs on the hardware, not the cloud" story and
the primary QNX prize target.

Planned contents (lands in milestones **M3 / M5**):

- **Camera capture + on-device face detection** and stable attribute extraction (skin
  tone, hair, glasses, hat, shirt) via an [oss.qnx.com](https://oss.qnx.com) AI module
  (ONNX Runtime / OpenCV DNN).
- **Parametric sprite params** emitted per detected person — deterministic (same person →
  same sprite), no raw video leaves the device.
- **Hardware GPIO mute switch + LED** — an RTOS-enforced capture kill that physically cuts
  camera + mic, with an LED showing recording state. This mute + on-device-detect pair
  *is* the QNX prize story.
- **Event emitter** — ships only derived data (sprite params, speaker embeddings,
  timestamps, transcript text) to the backend over MQTT/WebSocket.

Nothing here is wired up yet. See [`../DESIGN.md`](../DESIGN.md) §4–§5 (architecture,
hardware) and [`../PLAN.md`](../PLAN.md) workstream **A. Edge / QNX** for the target design.
