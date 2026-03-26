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
        sensevoice_model = os.path.join(model_dir, "model.onnx")
        paraformer_model = os.path.join(model_dir, "model.int8.onnx")
        tokens = os.path.join(model_dir, "tokens.txt")

        # Encoder/decoder paths: try both plain and model-name-prefixed variants
        encoder = os.path.join(model_dir, "encoder.onnx")
        decoder = os.path.join(model_dir, "decoder.onnx")
        if not os.path.exists(encoder):
            encoder = os.path.join(model_dir, f"{model_name}-encoder.onnx")
            decoder = os.path.join(model_dir, f"{model_name}-decoder.onnx")

        name_lower = model_name.lower()

        if ("sense-voice" in name_lower or "sensevoice" in name_lower) and os.path.exists(sensevoice_model):
            # SenseVoice model (non-autoregressive, single model file)
            recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=sensevoice_model,
                tokens=tokens,
                num_threads=4,
                use_itn=True,
            )
        elif "paraformer" in name_lower and os.path.exists(paraformer_model):
            # Paraformer model
            recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
                paraformer=paraformer_model,
                tokens=tokens,
                num_threads=4,
            )
        elif os.path.exists(encoder) and os.path.exists(decoder):
            # Whisper-style model
            recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=encoder,
                decoder=decoder,
                num_threads=4,
            )
        else:
            # Try int8 Whisper variants
            encoder_int8 = os.path.join(model_dir, f"{model_name}-encoder.int8.onnx")
            decoder_int8 = os.path.join(model_dir, f"{model_name}-decoder.int8.onnx")
            if os.path.exists(encoder_int8) and os.path.exists(decoder_int8):
                recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
                    encoder=encoder_int8,
                    decoder=decoder_int8,
                    num_threads=4,
                )
            else:
                output(
                    {
                        "error": f"Could not find model files in {model_dir}. "
                        f"Expected one of: model.onnx (SenseVoice), "
                        f"encoder.onnx+decoder.onnx (Whisper), "
                        f"model.int8.onnx (Paraformer)"
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

        result = stream.result
        text = result.text

        # SenseVoice may return language info via result.lang
        lang = getattr(result, "lang", None) or "en"

        output({"text": text.strip(), "language": lang})
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
