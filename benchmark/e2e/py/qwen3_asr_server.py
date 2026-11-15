"""Resident Qwen3-ASR (mlx-audio) process for the E2E bench.

Reads one JSON request per stdin line: {"id": n, "pcm_f32_b64": "..."} (16 kHz mono)
and writes one JSON line per response: {"id": n, "text": ..., "language": ..., "ms": ...}.
The model stays loaded so per-chunk latency excludes model load, unlike the
product's per-chunk speech-swift CLI.

Usage: python -I qwen3_asr_server.py <model id or path> [hotword ...]
"""
import base64
import json
import sys
import time

import numpy as np
from mlx_audio.stt.utils import load

LANG = {"japanese": "ja", "english": "en", "chinese": "zh", "korean": "ko"}


def main() -> None:
    model_id = sys.argv[1]
    hotwords = sys.argv[2:] or None
    model = load(model_id)
    # Warm up so the first real chunk does not pay graph compilation.
    model.generate(np.zeros(16000, dtype=np.float32), hotwords=hotwords)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        req = json.loads(line)
        audio = np.frombuffer(base64.b64decode(req["pcm_f32_b64"]), dtype=np.float32)
        t0 = time.perf_counter()
        out = model.generate(audio, hotwords=hotwords)
        ms = (time.perf_counter() - t0) * 1000
        # mlx-audio 0.6.5 returns one language per internal chunk as a list.
        langs = getattr(out, "language", None) or [""]
        if isinstance(langs, str):
            langs = [langs]
        lang = str(max(set(langs), key=langs.count) or "")
        print(
            json.dumps(
                {
                    "id": req["id"],
                    "text": out.text.strip(),
                    "language": LANG.get(lang.lower(), lang.lower()),
                    "ms": ms,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
