"""Builds 1x-speed E2E sessions from FLEURS test (ja_jp, en_us).

FLEURS rows that share an id are readings of the same FLoRes sentence, so the
other language's transcription of that id serves as the translation reference.

Writes <out>/<name>.f32 (16 kHz mono float32 LE) and <out>/<name>.json with
ground-truth utterance boundaries, language, transcript and reference translation.

Usage: python -I prep_fleurs.py <fleurs data dir> <out dir> <n per language> [seed]
"""
import csv
import json
import random
import statistics
import sys
import tarfile
import struct
from pathlib import Path

import numpy as np

SR = 16000
GAP_SEC = 2.0
LEAD_SEC = 1.0


def read_tsv(path: Path) -> dict:
    rows = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            rows.setdefault(r[0], []).append({"file": r[1], "raw": r[2], "samples": int(r[5])})
    return rows


def decode_wav(data: bytes) -> np.ndarray:
    """FLEURS wavs are IEEE float (format 3), which the stdlib wave module rejects."""
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    pos, fmt = 12, None
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            tag, ch, rate, _, _, bits = fmt
            assert ch == 1 and rate == SR, (ch, rate)
            if tag == 3 and bits == 32:
                return np.frombuffer(body, dtype="<f4").astype(np.float32)
            if tag == 1 and bits == 16:
                return np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768.0
            raise ValueError(f"unsupported wav format {tag}/{bits}")
        pos += 8 + size + (size & 1)
    raise ValueError("no data chunk")


def load_wavs(tar_path: Path, wanted: set) -> dict:
    out = {}
    with tarfile.open(tar_path, "r:gz") as tf:
        for m in tf:
            name = m.name.rsplit("/", 1)[-1]
            if name not in wanted:
                continue
            out[name] = decode_wav(tf.extractfile(m).read())
    return out


def speech_bounds(pcm: np.ndarray) -> tuple:
    """Speech onset/offset inside a FLEURS clip, which carries silence padding.

    Latency is measured from these points, not from the clip edges. Threshold:
    20 ms frames whose RMS exceeds 10% of the clip's 95th-percentile frame RMS.
    """
    hop = SR // 50
    n = len(pcm) // hop
    rms = np.sqrt(np.mean(pcm[: n * hop].reshape(n, hop) ** 2, axis=1))
    thr = max(1e-3, 0.1 * float(np.percentile(rms, 95)))
    voiced = np.nonzero(rms > thr)[0]
    if len(voiced) == 0:
        return 0.0, len(pcm) / SR
    return voiced[0] * hop / SR, (voiced[-1] + 1) * hop / SR


def write_session(out: Path, name: str, items: list, wavs: dict) -> None:
    parts = [np.zeros(int(LEAD_SEC * SR), dtype=np.float32)]
    t = LEAD_SEC
    utts = []
    for it in items:
        pcm = wavs[it["file"]]
        dur = len(pcm) / SR
        on, off = speech_bounds(pcm)
        utts.append(
            {
                **{k: v for k, v in it.items() if k != "file"},
                "clipStart": round(t, 4),
                "clipEnd": round(t + dur, 4),
                "start": round(t + on, 4),
                "end": round(t + off, 4),
            }
        )
        parts += [pcm, np.zeros(int(GAP_SEC * SR), dtype=np.float32)]
        t += dur + GAP_SEC
    audio = np.concatenate(parts)
    audio.astype("<f4").tofile(out / f"{name}.f32")
    meta = {"name": name, "sampleRate": SR, "durationSec": round(len(audio) / SR, 3), "utterances": utts}
    (out / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{name}: {len(utts)} utterances, {meta['durationSec']:.1f}s")


def main() -> None:
    data, out, n = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1115
    out.mkdir(parents=True, exist_ok=True)
    ja, en = read_tsv(data / "ja_jp/test.tsv"), read_tsv(data / "en_us/test.tsv")
    for lang, rows in (("ja", ja), ("en", en)):
        secs = [r["samples"] / SR for rs in rows.values() for r in rs]
        print(f"FLEURS {lang} test: {len(secs)} rows, {len(rows)} ids, mean {statistics.mean(secs):.2f}s, median {statistics.median(secs):.2f}s")
    shared = sorted(set(ja) & set(en))
    rng = random.Random(seed)
    rng.shuffle(shared)
    ja_ids, en_ids = shared[:n], shared[n : 2 * n]

    def item(rows, other, i, lang):
        r = rows[i][0]
        return {"id": f"{lang}-{i}", "lang": lang, "file": r["file"], "text": r["raw"], "ref": other[i][0]["raw"]}

    ja_items = [item(ja, en, i, "ja") for i in ja_ids]
    en_items = [item(en, ja, i, "en") for i in en_ids]
    wavs = {**load_wavs(data / "ja_jp/audio/test.tar.gz", {x["file"] for x in ja_items})}
    wavs.update(load_wavs(data / "en_us/audio/test.tar.gz", {x["file"] for x in en_items}))
    write_session(out, f"d1-ja-{n}", ja_items, wavs)
    write_session(out, f"d1-en-{n}", en_items, wavs)
    mixed = [x for pair in zip(ja_items, en_items) for x in pair]
    write_session(out, f"d2-mix-{2 * n}", mixed, wavs)


if __name__ == "__main__":
    main()
