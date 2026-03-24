#!/usr/bin/env python3
"""
Python subprocess bridge for Moonshine STT (Useful Sensors).
Communicates with the benchmark runner via JSON-over-stdio.

Protocol:
  Input (one per line):
    {"action": "init", "model": "moonshine/base"}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "..."}
    {"text": "...", "language": "en"}
    {"error": "..."}
"""
import sys
import json

model_instance = None

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model_name="moonshine/base"):
    global model_instance
    try:
        from moonshine import transcribe as moonshine_transcribe

        # Store the transcribe function — moonshine loads model on first call
        model_instance = {"model": model_name, "transcribe": moonshine_transcribe}

        output({"ready": True, "model": model_name})
    except ImportError:
        output({"error": "moonshine not installed. Run: pip install useful-moonshine"})
    except Exception as e:
        output({"error": f"Failed to initialize Moonshine: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global model_instance
    if model_instance is None:
        output({"error": "Model not initialized"})
        return

    try:
        fn = model_instance["transcribe"]
        model = model_instance["model"]

        result = fn(audio_path, model=model)

        # moonshine.transcribe returns a list of strings
        text = result[0] if isinstance(result, list) and len(result) > 0 else str(result)

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
                init_model(msg.get("model", "moonshine/base"))
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
