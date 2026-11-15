"""COMET-22 and chrF for score.ts *.comet.jsonl files.

    python -I comet_score.py [--accelerator mps|cpu] <file.comet.jsonl>...

Prints one JSON line per file and direction. Utterances with an empty translation
stay in (scored against the reference as-is) so missing output is penalized
instead of silently dropped.
chrF++ (word_order=2) is used for EN targets; JA has no spaces, so JA targets use
plain character chrF (word_order=0).
"""
import argparse
import json
import sys
import time

from comet import download_model, load_from_checkpoint
from sacrebleu.metrics import CHRF


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--accelerator", default="mps")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()

    t0 = time.time()
    model = load_from_checkpoint(download_model("Unbabel/wmt22-comet-da"))
    load_s = time.time() - t0

    for path in a.files:
        rows = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
        for src_lang in ("ja", "en"):
            rs = [r for r in rows if r["lang"] == src_lang]
            if not rs:
                continue
            data = [{"src": r["src"], "mt": r["mt"], "ref": r["ref"]} for r in rs]
            t1 = time.time()
            out = model.predict(
                data, batch_size=a.batch_size, gpus=1 if a.accelerator != "cpu" else 0,
                accelerator=a.accelerator, progress_bar=False,
            )
            chrf = CHRF(word_order=2 if src_lang == "ja" else 0)
            score = chrf.corpus_score([r["mt"] for r in rs], [[r["ref"] for r in rs]])
            print(json.dumps({
                "file": path,
                "direction": f"{src_lang}->{'en' if src_lang == 'ja' else 'ja'}",
                "n": len(rs),
                "empty": sum(1 for r in rs if not r["mt"].strip()),
                "comet22": round(out.system_score, 4),
                "chrf": round(score.score, 2),
                "chrf_variant": "chrF++" if src_lang == "ja" else "chrF",
                "accelerator": a.accelerator,
                "predict_s": round(time.time() - t1, 1),
                "model_load_s": round(load_s, 1),
            }, ensure_ascii=False))
            sys.stdout.flush()


if __name__ == "__main__":
    main()
