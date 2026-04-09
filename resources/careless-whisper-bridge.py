#!/usr/bin/env python3
"""
Python subprocess bridge for CarelessWhisper streaming STT.

CarelessWhisper applies LoRA fine-tuning to convert stock Whisper into a causal
streaming model that processes <300ms audio chunks without the Local Agreement
algorithm.

Protocol (JSON-over-stdio, one JSON object per line):
  Input:  {"action": "init", "model_size": "small", "chunk_size_ms": 300, "device": "cpu"}
  Input:  {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
  Input:  {"action": "dispose"}
  Output: {"text": "...", "language": "en"} or {"error": "..."}

Requirements:
  pip install careless-whisper-stream torch
  (GPU: pip install careless-whisper-stream torch --extra-index-url https://download.pytorch.org/whl/cu121)

References:
  - Paper: https://arxiv.org/abs/2508.12301
  - Code:  https://github.com/tomer9080/CarelessWhisper-streaming
"""
import sys
import json
import os

_current_req_id = None
_model = None
_chunk_size_ms = 300
_device = "cpu"


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data), flush=True)


def init_model(model_size="small", chunk_size_ms=300, device="cpu"):
    """Initialize CarelessWhisper causal streaming model."""
    global _model, _chunk_size_ms, _device

    _chunk_size_ms = chunk_size_ms
    _device = device

    try:
        output({"status": "Loading CarelessWhisper model..."})

        import torch
        from careless_whisper_stream import CarelessWhisperStream

        # Determine device: prefer MPS on macOS, then CUDA, then CPU
        if device == "auto":
            if torch.backends.mps.is_available():
                device = "mps"
            elif torch.cuda.is_available():
                device = "cuda"
            else:
                device = "cpu"

        _device = device

        output({"status": f"Loading {model_size} model on {device}..."})

        # CarelessWhisper supports: small, medium (EN-only), large-v2 (multilingual)
        _model = CarelessWhisperStream(
            model_size=model_size,
            chunk_size=chunk_size_ms,
            device=device,
        )

        # Determine language support based on model size
        multilingual = model_size == "large-v2"
        supported_languages = ["en", "fr", "es", "de", "pt"] if multilingual else ["en"]

        output({
            "ready": True,
            "model_size": model_size,
            "chunk_size_ms": chunk_size_ms,
            "device": device,
            "multilingual": multilingual,
            "supported_languages": supported_languages,
        })

    except ImportError as e:
        output({
            "error": (
                "careless-whisper-stream not installed. "
                "Install: pip install careless-whisper-stream torch"
            )
        })
    except Exception as e:
        output({"error": f"Failed to initialize CarelessWhisper: {e}"})


def transcribe(audio_path, sample_rate=16000):
    """Transcribe an audio chunk using CarelessWhisper causal inference."""
    global _model

    if _model is None:
        output({"error": "Model not initialized"})
        return

    try:
        import torch
        import numpy as np

        # Load audio from WAV file
        audio = _load_wav(audio_path)
        if audio is None or len(audio) == 0:
            output({"text": "", "language": "en"})
            return

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            # Simple linear interpolation resampling
            ratio = 16000 / sample_rate
            new_length = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_length)
            audio = np.interp(indices, np.arange(len(audio)), audio)

        # Convert to torch tensor
        audio_tensor = torch.from_numpy(audio.astype(np.float32)).to(_device)

        # CarelessWhisper causal transcription — processes the chunk directly
        # without needing the Local Agreement multi-pass approach
        result = _model.transcribe(audio_tensor)

        text = ""
        language = "en"

        if result is not None:
            if isinstance(result, dict):
                text = result.get("text", "").strip()
                language = result.get("language", "en")
            elif isinstance(result, str):
                text = result.strip()

        output({"text": text, "language": language})

    except Exception as e:
        output({"error": f"Transcription error: {e}"})


def _load_wav(path):
    """Load a WAV file and return audio samples as numpy float32 array."""
    import numpy as np

    with open(path, "rb") as f:
        data = f.read()

    # Skip WAV header (44 bytes for standard PCM WAV)
    if len(data) < 44:
        return None

    # Verify RIFF header
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None

    # Read format info
    bits_per_sample = int.from_bytes(data[34:36], "little")

    # Read audio data (after header)
    audio_data = data[44:]

    if bits_per_sample == 16:
        samples = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
    elif bits_per_sample == 32:
        samples = np.frombuffer(audio_data, dtype=np.float32)
    else:
        return None

    return samples


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
                    model_size=msg.get("model_size", "small"),
                    chunk_size_ms=msg.get("chunk_size_ms", 300),
                    device=msg.get("device", "auto"),
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
