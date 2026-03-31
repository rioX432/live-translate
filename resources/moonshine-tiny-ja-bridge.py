#!/usr/bin/env python3
"""
Python subprocess bridge for Moonshine Tiny JA STT.
Uses transformers AutoModelForSpeechSeq2Seq pipeline on Apple Silicon (MPS) or CPU.

Model: UsefulSensors/moonshine-tiny-ja (27M params, ~100MB)
Output: Japanese only — EN input produces garbage.
Note: Output has spaces between characters (e.g. "お は よ う") — caller strips them.

Protocol:
  Input (one per line):
    {"action": "init", "model": "UsefulSensors/moonshine-tiny-ja"}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "...", "device": "..."}
    {"text": "...", "language": "ja"}
    {"error": "..."}
"""
import sys
import json

pipe = None
_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model_name="UsefulSensors/moonshine-tiny-ja"):
    global pipe
    try:
        import torch
        from transformers import pipeline

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        dtype = torch.float16 if device == "mps" else torch.float32

        output({"status": f"Loading {model_name} on {device}..."})

        pipe = pipeline(
            "automatic-speech-recognition",
            model=model_name,
            torch_dtype=dtype,
            device=device,
        )

        output({"ready": True, "model": model_name, "device": device})
    except Exception as e:
        output({"error": f"Failed to initialize: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global pipe
    if pipe is None:
        output({"error": "Model not initialized"})
        return

    try:
        result = pipe(audio_path)
        text = result.get("text", "").strip() if isinstance(result, dict) else str(result).strip()
        output({"text": text, "language": "ja"})
    except Exception as e:
        output({"error": f"Transcription failed: {e}"})


def main():
    global _current_req_id
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            _current_req_id = msg.get("_reqId")
            action = msg.get("action")

            if action == "init":
                init_model(msg.get("model", "UsefulSensors/moonshine-tiny-ja"))
            elif action == "transcribe":
                transcribe(msg["audio_path"], msg.get("sample_rate", 16000))
            elif action == "dispose":
                output({"disposed": True})
                sys.exit(0)
            else:
                output({"error": f"Unknown action: {action}"})
        except json.JSONDecodeError:
            _current_req_id = None
            output({"error": "Invalid JSON"})
        except Exception as e:
            output({"error": str(e)})
        finally:
            _current_req_id = None


if __name__ == "__main__":
    main()
