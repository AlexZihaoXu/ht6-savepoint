# Two-speaker offline transcription

把一段录音离线转成**两个人的对话文字**：谁在什么时候说、说了什么，并处理**两人同时说话**的重叠段。

流程：**Community-1 说话人分离**（最准）→ 给每个说话人建干净音轨（重叠段用 **SepFormer** 拆开）→ **faster-whisper** 逐轨转写 → 按时间合并成 `Speaker N: 文字`。

## 环境

需要 `ffmpeg` 和两个 Python 3.12 虚拟环境（因为 Community-1 需要 pyannote 4.x，而分离/转写这套需要 pyannote 3.x，必须隔离）。

```bash
# 1) 批处理分离环境（Community-1）
uv venv --python 3.12 .venv
source .venv/bin/activate && uv pip install -r requirements.txt && deactivate

# 2) 转写 + 声源分离环境
uv venv --python 3.12 .venv-stream
source .venv-stream/bin/activate
uv pip install faster-whisper speechbrain \
  "pyannote.audio==3.4.0" "torch==2.2.2" "torchaudio==2.2.2" \
  "torchvision==0.17.2" "matplotlib==3.8.4" "huggingface_hub==0.25.2"
deactivate
```

在 Hugging Face 登录并接受这两个门控模型的条款，然后设置 token：

- https://huggingface.co/pyannote/speaker-diarization-community-1
- https://huggingface.co/pyannote/segmentation-3.0

```bash
export HF_TOKEN="hf_xxx"
```

（`pyannote/wespeaker-voxceleb-resnet34-LM` 和 `speechbrain/sepformer-wsj02mix` 无需授权，会自动下载。）

## 用法

```bash
export HF_TOKEN="hf_xxx"

# 转写整段
./transcribe.sh input.mp3 out.json

# 只转写一个片段：START=起始秒  DUR=时长秒
START=600 DUR=120 ./transcribe.sh test.mp3 out.json

# 更快但略糙的转写模型
MODEL=base.en ./transcribe.sh input.mp3 out.json
```

终端打印每句 `[开始 - 结束] Speaker N: 文字`，重叠段标 `⚠ overlap`；同时写入 `out.json`（每条含 `start`/`end`/`speaker`/`text`/`overlap`）。

## 测试用例

```bash
HF_TOKEN="hf_xxx" ./make_testcases.sh test.mp3
```

从录音的不同位置截取若干段，各生成 `testcases/<名字>.{wav,json,txt}`（音频 + 转录 JSON + 文本），用于对比模型输出。

## 文件

| 文件 | 作用 |
|------|------|
| `transcribe.sh` | 主命令：截取 → 分离 → 转写 → 合并 |
| `diarize.py` | Community-1 说话人分离，输出时间段 JSON |
| `align.py` | 每人建干净音轨（重叠段 SepFormer 拆分）+ 逐轨转写对齐 |
| `make_testcases.sh` | 从录音批量截取若干段生成测试用例 |
| `requirements.txt` | `.venv`（Community-1）的依赖 |

各脚本可单独运行，加 `-h` 看参数。`align.py --no-separate` 可跳过声源分离（更快，重叠段归给主说话人不拆）。
