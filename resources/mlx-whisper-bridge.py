#!/usr/bin/env python3
"""
Python subprocess bridge for mlx-whisper STT.
Receives PCM audio data via stdin (as raw bytes), outputs JSON results via stdout.

Protocol:
  Input (one per line): JSON {"action": "transcribe", "audio_path": "/tmp/audio.pcm", "sample_rate": 16000}
  Input: {"action": "init", "model": "mlx-community/whisper-large-v3-turbo"}
  Input: {"action": "dispose"}
  Output: JSON {"text": "...", "language": "ja"} or {"error": "..."}
"""
import sys
import json
import tempfile
import os
import numpy as np

whisper_model = None
whisper_processor = None

def init_model(model_name="mlx-community/whisper-large-v3-turbo"):
    global whisper_model, whisper_processor
    try:
        import mlx_whisper
        whisper_model = model_name
        output({"ready": True, "model": model_name})
    except ImportError:
        output({"error": "mlx-whisper not installed. Run: pip install mlx-whisper"})

def transcribe(audio_path, sample_rate=16000):
    global whisper_model
    if not whisper_model:
        output({"error": "Model not initialized"})
        return

    try:
        import mlx_whisper
        result = mlx_whisper.transcribe(
            audio_path,
            path_or_hf_repo=whisper_model,
            language=None,  # auto-detect
        )

        text = result.get("text", "").strip()
        language = result.get("language", "en")

        # Map to our language codes
        lang = "ja" if language == "ja" else "en"

        output({"text": text, "language": lang})
    except Exception as e:
        output({"error": str(e)})

def output(data):
    print(json.dumps(data), flush=True)

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            action = msg.get("action")

            if action == "init":
                init_model(msg.get("model", "mlx-community/whisper-large-v3-turbo"))
            elif action == "transcribe":
                transcribe(msg["audio_path"], msg.get("sample_rate", 16000))
            elif action == "dispose":
                output({"disposed": True})
                sys.exit(0)
            else:
                output({"error": f"Unknown action: {action}"})
        except json.JSONDecodeError:
            output({"error": "Invalid JSON"})
        except Exception as e:
            output({"error": str(e)})

if __name__ == "__main__":
    main()
