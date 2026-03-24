#!/usr/bin/env python3
"""
Python subprocess bridge for Qwen2-Audio ASR.
Communicates with the benchmark runner via JSON-over-stdio.

Protocol:
  Input (one per line):
    {"action": "init", "model": "Qwen/Qwen2-Audio-7B-Instruct"}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "..."}
    {"text": "...", "language": "ja"}
    {"error": "..."}
"""
import sys
import json

processor = None
model = None
model_name_global = None

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model_name="Qwen/Qwen2-Audio-7B-Instruct"):
    global processor, model, model_name_global
    try:
        import torch
        from transformers import Qwen2AudioForConditionalGeneration, AutoProcessor

        output({"status": "Loading Qwen2-Audio model..."})

        # Determine device
        device = "cpu"
        dtype = torch.float32
        if torch.backends.mps.is_available():
            device = "mps"
            dtype = torch.float16
        elif torch.cuda.is_available():
            device = "cuda"
            dtype = torch.float16

        processor = AutoProcessor.from_pretrained(model_name)
        model = Qwen2AudioForConditionalGeneration.from_pretrained(
            model_name, torch_dtype=dtype, device_map=device
        )
        model_name_global = model_name

        output({"ready": True, "model": model_name, "device": device})
    except ImportError:
        output({"error": "transformers not installed. Run: pip install transformers torch"})
    except Exception as e:
        output({"error": f"Failed to initialize Qwen2-Audio: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global processor, model
    if model is None or processor is None:
        output({"error": "Model not initialized"})
        return

    try:
        import librosa
        import torch

        # Load audio
        audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)

        # Build conversation-style input for Qwen2-Audio
        conversation = [
            {
                "role": "user",
                "content": [
                    {"type": "audio", "audio_url": audio_path},
                    {"type": "text", "text": "Transcribe this audio."},
                ],
            }
        ]

        text_input = processor.apply_chat_template(
            conversation, add_generation_prompt=True, tokenize=False
        )
        inputs = processor(
            text=text_input, audios=[audio], sampling_rate=sr, return_tensors="pt"
        )
        inputs = inputs.to(model.device)

        with torch.no_grad():
            generated_ids = model.generate(**inputs, max_new_tokens=256)

        # Decode only the generated part
        input_len = inputs.input_ids.shape[1]
        generated_ids = generated_ids[:, input_len:]
        text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

        output({"text": text.strip(), "language": "en"})
    except ImportError as e:
        output({"error": f"Missing dependency: {e}. Run: pip install librosa"})
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
                init_model(msg.get("model", "Qwen/Qwen2-Audio-7B-Instruct"))
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
