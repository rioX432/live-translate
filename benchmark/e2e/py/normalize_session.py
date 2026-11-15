"""Level-normalize each clip of a prepared session (16 kHz mono float32).

Many FLEURS EN clips sit near -59 dBFS speech RMS, about 37 dB below the JA clips,
which makes the VAD drop or split them. A live microphone path may level this out
with AGC, so the bench scales every clip to the same speech level to separate the
level effect from ASR differences. Gain is capped so no clip peaks above PEAK_CAP.

    python -I normalize_session.py <in.json> <out_name> [target_dbfs=-26]

Writes <out_name>.f32 and <out_name>.json next to the input. Timings are unchanged.
"""
import json
import sys
from pathlib import Path

import numpy as np

SR = 16000
PEAK_CAP = 0.9


def main() -> None:
    src = Path(sys.argv[1])
    name = sys.argv[2]
    target = float(sys.argv[3]) if len(sys.argv) > 3 else -26.0
    meta = json.loads(src.read_text(encoding="utf-8"))
    pcm = np.fromfile(src.with_suffix(".f32"), dtype=np.float32).copy()
    gains = []
    for u in meta["utterances"]:
        a, b = int(u["clipStart"] * SR), int(u["clipEnd"] * SR)
        speech = pcm[int(u["start"] * SR):int(u["end"] * SR)]
        rms = float(np.sqrt(np.mean(speech**2))) + 1e-9
        peak = float(np.max(np.abs(pcm[a:b]))) + 1e-9
        gain = min(10 ** (target / 20) / rms, PEAK_CAP / peak)
        pcm[a:b] *= gain
        gains.append(20 * np.log10(gain))
    out = src.parent / name
    pcm.astype("<f4").tofile(out.with_suffix(".f32"))
    meta["name"] = name
    meta["normalizedDbfs"] = target
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{name}: gain dB median {np.median(gains):.1f} min {np.min(gains):.1f} max {np.max(gains):.1f}")


if __name__ == "__main__":
    main()
