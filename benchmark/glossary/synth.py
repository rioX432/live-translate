"""Synthesize every sentence in data/sentences.json with macOS `say`.

Writes 16 kHz mono 16-bit WAV, the format the app's VAD feeds to STT. Voices match
benchmark/scripts/generate-stt-testset.sh.

Usage: python3 -I synth.py <output directory>
"""
import json
import os
import subprocess
import sys

VOICES = {"ja": "Kyoko", "en": "Samantha"}


def main() -> None:
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "data", "sentences.json"), encoding="utf-8") as f:
        data = json.load(f)
    count = 0
    for utts in data["sets"].values():
        for u in utts:
            subprocess.run(
                ["say", "-v", VOICES[u["lang"]], "--file-format=WAVE", "--data-format=LEI16@16000",
                 "-o", os.path.join(out, f"{u['id']}.wav"), u["text"]],
                check=True,
            )
            count += 1
    print(f"wrote {count} files to {out}")


if __name__ == "__main__":
    main()
