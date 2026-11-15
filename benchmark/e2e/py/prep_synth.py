"""Builds a D3/D4 session from benchmark/e2e/data/*.json with macOS `say`.

    python -I prep_synth.py <data.json> <out-dir>

Voices: Kyoko (ja_JP) and Samantha (en_US), as in benchmark/scripts/generate-stt-testset.sh.
Output layout matches prep_fleurs.py (<name>.f32 + <name>.json), plus per-utterance
wavs under <out-dir>/<name>-wav/ for engines that take files.
"""
import json
import subprocess
import sys
from pathlib import Path

# -I drops the script directory from sys.path; prep_fleurs sits next to this file.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prep_fleurs import decode_wav, write_session  # noqa: E402

VOICES = {"ja": "Kyoko", "en": "Samantha"}


def main() -> None:
    data_path, out = Path(sys.argv[1]), Path(sys.argv[2])
    data = json.loads(data_path.read_text(encoding="utf-8"))
    name = data["name"]
    wav_dir = out / f"{name}-wav"
    wav_dir.mkdir(parents=True, exist_ok=True)
    wavs = {}
    items = []
    for u in data["utterances"]:
        wav = wav_dir / f"{u['id']}.wav"
        subprocess.run(
            ["say", "-v", VOICES[u["lang"]], "--file-format=WAVE", "--data-format=LEI16@16000",
             "-o", str(wav), u["text"]],
            check=True,
        )
        wavs[wav.name] = decode_wav(wav.read_bytes())
        items.append({**u, "file": wav.name})
    write_session(out, name, items, wavs)


if __name__ == "__main__":
    main()
