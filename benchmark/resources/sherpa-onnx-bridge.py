#!/usr/bin/env python3
"""
Python subprocess bridge for Sherpa-ONNX STT.
Communicates with the benchmark runner via JSON-over-stdio.

Protocol:
  Input (one per line):
    {"action": "init", "model": "sherpa-onnx-whisper-medium"}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "..."}
    {"text": "...", "language": "en"}
    {"error": "..."}
"""
import sys
import json
import os

recognizer = None

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model_name="sherpa-onnx-whisper-medium"):
    global recognizer
    try:
        import sherpa_onnx

        output({"status": f"Loading Sherpa-ONNX model: {model_name}..."})

        # Sherpa-ONNX expects model files in a directory
        # Try common model path patterns
        model_dir = os.path.join(os.path.dirname(__file__), "..", "models", model_name)
        if not os.path.isdir(model_dir):
            # Fall back to home directory cache
            model_dir = os.path.join(
                os.path.expanduser("~"), ".cache", "sherpa-onnx", model_name
            )

        if not os.path.isdir(model_dir):
            output(
                {
                    "error": f"Model directory not found: {model_dir}. "
                    f"Download from https://github.com/k2-fsa/sherpa-onnx/releases"
                }
            )
            return

        # Detect model type and create recognizer
        encoder = os.path.join(model_dir, f"{model_name}-encoder.onnx")
        decoder = os.path.join(model_dir, f"{model_name}-decoder.onnx")

        if os.path.exists(encoder) and os.path.exists(decoder):
            # Whisper-style model
            recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=encoder,
                decoder=decoder,
                num_threads=4,
            )
        else:
            # Try int8 variants
            encoder = os.path.join(model_dir, f"{model_name}-encoder.int8.onnx")
            decoder = os.path.join(model_dir, f"{model_name}-decoder.int8.onnx")
            if os.path.exists(encoder) and os.path.exists(decoder):
                recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                    encoder=encoder,
                    decoder=decoder,
                    num_threads=4,
                )
            else:
                output(
                    {
                        "error": f"Could not find encoder/decoder files in {model_dir}"
                    }
                )
                return

        output({"ready": True, "model": model_name})
    except ImportError:
        output({"error": "sherpa-onnx not installed. Run: pip install sherpa-onnx"})
    except Exception as e:
        output({"error": f"Failed to initialize Sherpa-ONNX: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global recognizer
    if recognizer is None:
        output({"error": "Model not initialized"})
        return

    try:
        import wave
        import numpy as np

        # Read WAV file
        with wave.open(audio_path, "rb") as wf:
            assert wf.getnchannels() == 1, "Expected mono audio"
            assert wf.getsampwidth() == 2, "Expected 16-bit audio"
            sr = wf.getframerate()
            frames = wf.readframes(wf.getnframes())

        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

        # Resample if needed
        if sr != sample_rate:
            import librosa
            samples = librosa.resample(samples, orig_sr=sr, target_sr=sample_rate)

        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        recognizer.decode_stream(stream)

        text = stream.result.text

        output({"text": text.strip(), "language": "en"})
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
                init_model(msg.get("model", "sherpa-onnx-whisper-medium"))
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
