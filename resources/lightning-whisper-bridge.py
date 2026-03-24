#!/usr/bin/env python3
"""
Python subprocess bridge for Lightning Whisper MLX STT.
Communicates with the Electron main process via JSON-over-stdio.

Lightning Whisper MLX achieves ~10x faster inference than whisper.cpp
and ~4x faster than standard MLX Whisper on Apple Silicon.

Protocol:
  Input (one per line):
    {"action": "init", "model": "distil-large-v3", "batch_size": 12, "quant": null}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "..."}
    {"text": "...", "language": "ja"}
    {"error": "..."}
"""
import sys
import json

whisper_instance = None

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model="distil-large-v3", batch_size=12, quant=None):
    global whisper_instance
    try:
        from lightning_whisper_mlx import LightningWhisperMLX

        output({"status": "Loading Lightning Whisper MLX model..."})

        whisper_instance = LightningWhisperMLX(
            model=model,
            batch_size=batch_size,
            quant=quant,
        )

        output({"ready": True, "model": model})
    except ImportError:
        output(
            {
                "error": "lightning-whisper-mlx not installed. Run: pip install lightning-whisper-mlx"
            }
        )
    except Exception as e:
        output({"error": f"Failed to initialize Lightning Whisper MLX: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global whisper_instance
    if whisper_instance is None:
        output({"error": "Model not initialized"})
        return

    try:
        result = whisper_instance.transcribe(audio_path=audio_path)

        text = result.get("text", "").strip()
        language = result.get("language", "en")

        output({"text": text, "language": language})
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
                init_model(
                    model=msg.get("model", "distil-large-v3"),
                    batch_size=msg.get("batch_size", 12),
                    quant=msg.get("quant"),
                )
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
