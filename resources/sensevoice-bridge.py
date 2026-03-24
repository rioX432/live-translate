#!/usr/bin/env python3
"""
Python subprocess bridge for SenseVoice STT (FunASR).
Communicates with the Electron main process via JSON-over-stdio.

Protocol:
  Input (one per line):
    {"action": "init", "model": "FunAudioLLM/SenseVoiceSmall"}
    {"action": "transcribe", "audio_path": "/tmp/audio.wav", "sample_rate": 16000}
    {"action": "dispose"}
  Output (one per line):
    {"ready": true, "model": "..."}
    {"text": "...", "language": "ja", "emotion": "happy"}
    {"error": "..."}
"""
import sys
import json

model_instance = None

# SenseVoice language tokens to ISO 639-1 mapping
LANG_MAP = {
    "zh": "zh",
    "en": "en",
    "ja": "ja",
    "ko": "ko",
    "yue": "zh",  # Cantonese -> Chinese
    "nospeech": "",
}

_current_req_id = None


def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def init_model(model_name="FunAudioLLM/SenseVoiceSmall"):
    global model_instance
    try:
        from funasr import AutoModel

        output({"status": "Loading SenseVoice model..."})

        # Determine device: prefer MPS on macOS, then CUDA, then CPU
        device = "cpu"
        try:
            import torch
            if torch.backends.mps.is_available():
                device = "mps"
            elif torch.cuda.is_available():
                device = "cuda:0"
        except Exception:
            pass

        model_instance = AutoModel(
            model=model_name,
            trust_remote_code=True,
            vad_model="fsmn-vad",
            vad_kwargs={"max_single_segment_time": 30000},
            device=device,
            hub="hf",
        )

        output({"ready": True, "model": model_name, "device": device})
    except ImportError:
        output({"error": "funasr not installed. Run: pip install funasr"})
    except Exception as e:
        output({"error": f"Failed to initialize SenseVoice: {e}"})


def transcribe(audio_path, sample_rate=16000):
    global model_instance
    if model_instance is None:
        output({"error": "Model not initialized"})
        return

    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        res = model_instance.generate(
            input=audio_path,
            cache={},
            language="auto",
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )

        if not res or len(res) == 0:
            output({"text": "", "language": "en"})
            return

        raw_text = res[0].get("text", "")

        # Extract language from the raw output tags (e.g. <|ja|>, <|en|>)
        detected_lang = "en"
        for token, iso_code in LANG_MAP.items():
            if f"<|{token}|>" in raw_text:
                detected_lang = iso_code if iso_code else "en"
                break

        # Extract emotion tag if present (e.g. <|HAPPY|>, <|SAD|>, <|ANGRY|>, <|NEUTRAL|>)
        emotion = None
        for emo_tag in ["HAPPY", "SAD", "ANGRY", "NEUTRAL"]:
            if f"<|{emo_tag}|>" in raw_text:
                emotion = emo_tag.lower()
                break

        # Clean up the text using FunASR's postprocessing
        text = rich_transcription_postprocess(raw_text)

        result = {"text": text.strip(), "language": detected_lang}
        if emotion:
            result["emotion"] = emotion

        output(result)
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
                init_model(msg.get("model", "FunAudioLLM/SenseVoiceSmall"))
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
