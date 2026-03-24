#!/usr/bin/env python3
"""
Python subprocess bridge for Lightning Whisper MLX STT.
Uses lightning-whisper-mlx for ~10x faster inference on Apple Silicon,
with automatic fallback to standard mlx-whisper if lightning variant is unavailable.

Protocol:
  Input (one per line): JSON {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
  Input: {"action": "init", "model": "distil-large-v3", "batch_size": 12, "quant": null}
  Input: {"action": "dispose"}
  Output: JSON {"text": "...", "language": "ja"} or {"error": "..."}
"""
import sys
import json

# Supported language codes matching the TypeScript Language type
SUPPORTED_LANGUAGES = {
    "ja", "en", "zh", "ko", "fr", "de", "es", "pt",
    "ru", "it", "nl", "pl", "ar", "th", "vi", "id"
}

whisper = None
fallback_model = None
using_fallback = False

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data), flush=True)


def init_model(model="distil-large-v3", batch_size=12, quant=None):
    global whisper, fallback_model, using_fallback

    # Try lightning-whisper-mlx first
    try:
        from lightning_whisper_mlx import LightningWhisperMLX
        whisper = LightningWhisperMLX(model=model, batch_size=batch_size, quant=quant)
        using_fallback = False
        output({"ready": True, "model": model, "engine": "lightning-whisper-mlx"})
        return
    except ImportError:
        output({"status": "lightning-whisper-mlx not found, trying mlx-whisper fallback..."})
    except Exception as e:
        output({"status": f"lightning-whisper-mlx init failed ({e}), trying fallback..."})

    # Fallback to standard mlx-whisper
    try:
        import mlx_whisper
        # Map lightning model names to mlx-whisper HF repo names
        model_map = {
            "tiny": "mlx-community/whisper-tiny",
            "base": "mlx-community/whisper-base",
            "small": "mlx-community/whisper-small",
            "medium": "mlx-community/whisper-medium",
            "large": "mlx-community/whisper-large",
            "large-v2": "mlx-community/whisper-large-v2-mlx",
            "large-v3": "mlx-community/whisper-large-v3-mlx",
            "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
            "distil-small.en": "mlx-community/distil-whisper-small.en",
            "distil-medium.en": "mlx-community/distil-whisper-medium.en",
            "distil-large-v2": "mlx-community/distil-whisper-large-v2",
            "distil-large-v3": "mlx-community/distil-whisper-large-v3",
        }
        fallback_model = model_map.get(model, "mlx-community/whisper-large-v3-turbo")
        using_fallback = True
        output({"ready": True, "model": fallback_model, "engine": "mlx-whisper-fallback"})
    except ImportError:
        output({"error": "Neither lightning-whisper-mlx nor mlx-whisper installed. Run: pip install lightning-whisper-mlx"})


def transcribe(audio_path, sample_rate=16000):
    global whisper, fallback_model, using_fallback

    if not using_fallback and whisper is None:
        output({"error": "Model not initialized"})
        return
    if using_fallback and fallback_model is None:
        output({"error": "Model not initialized"})
        return

    try:
        if not using_fallback:
            # Lightning Whisper MLX path
            result = whisper.transcribe(audio_path=audio_path)
        else:
            # Standard mlx-whisper fallback
            import mlx_whisper
            result = mlx_whisper.transcribe(
                audio_path,
                path_or_hf_repo=fallback_model,
                language=None,
            )

        text = result.get("text", "").strip()
        language = result.get("language", "en")

        # Normalize language code to supported set
        lang = language if language in SUPPORTED_LANGUAGES else "en"

        output({"text": text, "language": lang})
    except Exception as e:
        output({"error": str(e)})


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
