#!/usr/bin/env python3
"""
Python subprocess bridge for CTranslate2-accelerated Madlad-400 translation.

Madlad-400 is a T5-based multilingual translation model supporting 450+ languages.
It uses language tags in the format "<2xx>" prepended to source text.

Protocol (stdin/stdout JSON lines):
  Input:  {"action": "init", "model": "Nextcloud-AI/madlad400-3b-mt-ct2-int8", "device": "auto"}
  Input:  {"action": "translate", "text": "...", "target_lang": "en"}
  Input:  {"action": "dispose"}
  Output: {"ready": true} | {"translated": "..."} | {"error": "..."}

Dependencies: pip install ctranslate2 sentencepiece
"""
import sys
import json
import os

# Global state
translator = None
sp_processor = None
_current_req_id = None


def output(data):
    """Write JSON response to stdout."""
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data), flush=True)


def get_cache_dir():
    """Get the model cache directory."""
    base = os.environ.get("CT2_CACHE_DIR") or os.path.join(
        os.path.expanduser("~"), ".cache", "live-translate", "ct2-models"
    )
    os.makedirs(base, exist_ok=True)
    return base


def download_model(model_name):
    """Download pre-converted CTranslate2 model from HuggingFace if not cached."""
    safe_name = model_name.replace("/", "_")
    model_dir = os.path.join(get_cache_dir(), safe_name)

    model_file = os.path.join(model_dir, "model.bin")
    if os.path.exists(model_file):
        return model_dir

    output({"status": f"Downloading {model_name}..."})

    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=model_name,
            local_dir=model_dir,
            local_dir_use_symlinks=False,
        )
    except ImportError:
        # Fallback: try using ctranslate2 converter from the original HF model
        output({"status": "huggingface_hub not found, trying converter fallback..."})
        try:
            import ctranslate2

            original_model = "google/madlad400-3b-mt"
            output({"status": f"Converting {original_model} to CTranslate2 (int8)..."})
            converter = ctranslate2.converters.TransformersConverter(original_model)
            converter.convert(model_dir, quantization="int8", force=True)
        except Exception as e:
            output({"error": f"Model download/conversion failed: {e}. "
                    "Run: pip install huggingface_hub ctranslate2 sentencepiece"})
            return None

    return model_dir


def download_tokenizer():
    """Download the SentencePiece tokenizer for Madlad-400."""
    tokenizer_dir = os.path.join(get_cache_dir(), "madlad400_tokenizer")
    spm_path = os.path.join(tokenizer_dir, "sentencepiece.model")

    if os.path.exists(spm_path):
        return spm_path

    os.makedirs(tokenizer_dir, exist_ok=True)
    output({"status": "Downloading Madlad-400 tokenizer..."})

    try:
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id="google/madlad400-3b-mt",
            filename="sentencepiece.model",
            local_dir=tokenizer_dir,
            local_dir_use_symlinks=False,
        )
        return downloaded
    except ImportError:
        # Fallback: try transformers AutoTokenizer
        try:
            from transformers import AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained("google/madlad400-3b-mt")
            # Save the sp model from the tokenizer
            if hasattr(tokenizer, "vocab_file") and os.path.exists(tokenizer.vocab_file):
                import shutil
                shutil.copy2(tokenizer.vocab_file, spm_path)
                return spm_path
        except Exception:
            pass

        output({"error": "Cannot download tokenizer. "
                "Run: pip install huggingface_hub sentencepiece"})
        return None


def init_model(model_name="Nextcloud-AI/madlad400-3b-mt-ct2-int8", device="auto"):
    """Initialize CTranslate2 translator with Madlad-400."""
    global translator, sp_processor

    try:
        import ctranslate2
        import sentencepiece as spm
    except ImportError as e:
        output({
            "error": f"Missing dependency: {e}. "
            "Run: pip install ctranslate2 sentencepiece huggingface_hub"
        })
        return

    # Resolve device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"

    # Download model
    model_dir = download_model(model_name)
    if not model_dir:
        return

    # Download tokenizer
    spm_path = download_tokenizer()
    if not spm_path:
        return

    try:
        output({"status": "Loading Madlad-400 model..."})

        translator = ctranslate2.Translator(
            model_dir,
            device=device,
            compute_type="int8",
            inter_threads=1,
            intra_threads=os.cpu_count() or 4,
        )

        sp_processor = spm.SentencePieceProcessor()
        sp_processor.Load(spm_path)

        output({"ready": True, "device": device, "quantization": "int8"})
    except Exception as e:
        output({"error": f"Failed to load Madlad-400 model: {e}"})


def translate(text, target_lang):
    """Translate text using Madlad-400 via CTranslate2."""
    if translator is None or sp_processor is None:
        output({"error": "Model not initialized"})
        return

    if not text or not text.strip():
        output({"translated": ""})
        return

    try:
        # Prepend target language tag: "<2en> source text"
        tagged_text = f"<2{target_lang}> {text}"

        # Tokenize with SentencePiece
        tokens = sp_processor.Encode(tagged_text, out_type=str)

        # Add EOS token for T5 models
        tokens.append("</s>")

        # Translate
        results = translator.translate_batch(
            [tokens],
            beam_size=4,
            max_decoding_length=256,
            repetition_penalty=1.2,
        )

        # Decode output tokens
        target_tokens = results[0].hypotheses[0]
        translated = sp_processor.Decode(target_tokens)

        output({"translated": translated})
    except Exception as e:
        output({"error": f"Translation failed: {e}"})


def dispose():
    """Release all model resources."""
    global translator, sp_processor
    translator = None
    sp_processor = None
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
                    model_name=msg.get("model", "Nextcloud-AI/madlad400-3b-mt-ct2-int8"),
                    device=msg.get("device", "auto"),
                )
            elif action == "translate":
                translate(msg.get("text", ""), msg.get("target_lang", "en"))
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
