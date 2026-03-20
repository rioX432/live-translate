#!/usr/bin/env python3
"""
Python subprocess bridge for CTranslate2-accelerated OPUS-MT translation.

Protocol (stdin/stdout JSON lines):
  Input:  {"action": "init", "model_ja_en": "Helsinki-NLP/opus-mt-ja-en", "model_en_ja": "Helsinki-NLP/opus-mt-en-jap", "device": "auto", "quantization": "int8"}
  Input:  {"action": "translate", "text": "...", "direction": "ja-en"}
  Input:  {"action": "dispose"}
  Output: {"ready": true} | {"translated": "..."} | {"error": "..."}

Dependencies: pip install ctranslate2 transformers sentencepiece
"""
import sys
import json
import os
import shutil

# Global state
translators = {}  # direction -> ctranslate2.Translator
tokenizers = {}   # direction -> transformers.AutoTokenizer
_current_req_id = None


def output(data):
    """Write JSON response to stdout."""
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data), flush=True)


def get_cache_dir():
    """Get the model cache directory."""
    # Use XDG cache or fallback
    base = os.environ.get("CT2_CACHE_DIR") or os.path.join(
        os.path.expanduser("~"), ".cache", "live-translate", "ct2-models"
    )
    os.makedirs(base, exist_ok=True)
    return base


def convert_model(hf_model_name, quantization="int8"):
    """Convert a HuggingFace OPUS-MT model to CTranslate2 format if not already done."""
    import ctranslate2

    safe_name = hf_model_name.replace("/", "_")
    output_dir = os.path.join(get_cache_dir(), f"{safe_name}_ct2_{quantization}")

    # Check if already converted
    model_file = os.path.join(output_dir, "model.bin")
    if os.path.exists(model_file):
        return output_dir

    # Convert using CTranslate2 converter
    output({"status": f"Converting {hf_model_name} to CTranslate2 ({quantization})..."})

    converter = ctranslate2.converters.TransformersConverter(hf_model_name)
    converter.convert(output_dir, quantization=quantization, force=True)

    return output_dir


def init_model(
    model_ja_en="Helsinki-NLP/opus-mt-ja-en",
    model_en_ja="Helsinki-NLP/opus-mt-en-jap",
    device="auto",
    quantization="int8",
):
    """Initialize CTranslate2 translators for both directions."""
    global translators, tokenizers

    try:
        import ctranslate2
        from transformers import AutoTokenizer
    except ImportError as e:
        output(
            {
                "error": f"Missing dependency: {e}. "
                "Run: pip install ctranslate2 transformers sentencepiece"
            }
        )
        return

    # Resolve device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"

    directions = {"ja-en": model_ja_en, "en-ja": model_en_ja}

    for direction, hf_model in directions.items():
        try:
            output({"status": f"Loading {direction} model..."})

            # Convert model to CT2 format (cached)
            ct2_dir = convert_model(hf_model, quantization)

            # Load translator
            translators[direction] = ctranslate2.Translator(
                ct2_dir,
                device=device,
                compute_type=quantization,
                inter_threads=1,
                intra_threads=os.cpu_count() or 4,
            )

            # Load tokenizer from original HF model
            tokenizers[direction] = AutoTokenizer.from_pretrained(hf_model)

        except Exception as e:
            output({"error": f"Failed to load {direction} model: {e}"})
            return

    output({"ready": True, "device": device, "quantization": quantization})


def translate(text, direction):
    """Translate text using CTranslate2."""
    if direction not in translators:
        output({"error": f"Model not initialized for direction: {direction}"})
        return

    if not text or not text.strip():
        output({"translated": ""})
        return

    try:
        translator = translators[direction]
        tokenizer = tokenizers[direction]

        # Tokenize using HF tokenizer
        encoded = tokenizer.encode(text)
        tokens = tokenizer.convert_ids_to_tokens(encoded)

        # Translate
        results = translator.translate_batch(
            [tokens],
            beam_size=4,
            max_decoding_length=256,
            repetition_penalty=1.2,
        )

        # Decode output tokens
        target_tokens = results[0].hypotheses[0]
        target_ids = tokenizer.convert_tokens_to_ids(target_tokens)
        translated = tokenizer.decode(target_ids, skip_special_tokens=True)

        output({"translated": translated})
    except Exception as e:
        output({"error": f"Translation failed: {e}"})


def dispose():
    """Release all model resources."""
    global translators, tokenizers
    translators.clear()
    tokenizers.clear()
    output({"disposed": True})
    sys.exit(0)


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
                    model_ja_en=msg.get("model_ja_en", "Helsinki-NLP/opus-mt-ja-en"),
                    model_en_ja=msg.get("model_en_ja", "Helsinki-NLP/opus-mt-en-jap"),
                    device=msg.get("device", "auto"),
                    quantization=msg.get("quantization", "int8"),
                )
            elif action == "translate":
                translate(msg.get("text", ""), msg.get("direction", "ja-en"))
            elif action == "dispose":
                dispose()
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
