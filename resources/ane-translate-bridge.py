#!/usr/bin/env python3
"""
Python subprocess bridge for ANEMLL Apple Neural Engine translation.

Converts TranslateGemma (or other supported models) to CoreML format
and runs inference on the Apple Neural Engine for ultra-efficient translation.

Protocol (stdin/stdout JSON lines):
  Input:  {"action": "init", "model": "google/gemma-3-4b-it", "context_length": 512}
  Input:  {"action": "translate", "text": "...", "from": "ja", "to": "en"}
  Input:  {"action": "dispose"}
  Output: {"ready": true} | {"translated": "..."} | {"error": "..."}

Requirements:
  - macOS with Apple Silicon (M1+)
  - Python 3.9-3.11 (3.9 recommended)
  - pip install anemll coremltools transformers pyyaml numpy torch
"""
import sys
import json
import os
import subprocess
import glob

# Global state
_current_req_id = None
_model = None
_tokenizer = None
_state = None
_causal_mask = None
_context_length = 512
_batch_size = 64
_metadata = None
_prefill_fn = None
_generate_fn = None
_is_monolithic = False


def output(data):
    """Write JSON response to stdout."""
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data, ensure_ascii=False), flush=True)


def get_cache_dir():
    """Get the model cache directory for converted CoreML models."""
    base = os.environ.get("ANEMLL_CACHE_DIR") or os.path.join(
        os.path.expanduser("~"), ".cache", "live-translate", "ane-models"
    )
    os.makedirs(base, exist_ok=True)
    return base


def find_anemll_package():
    """Find the anemll package installation directory."""
    try:
        import anemll
        return os.path.dirname(os.path.dirname(anemll.__file__))
    except ImportError:
        return None


def convert_model_to_coreml(hf_model_name, output_dir, context_length=512):
    """Convert HuggingFace model to CoreML format using ANEMLL.

    Returns the path to the meta.yaml file.
    """
    meta_path = os.path.join(output_dir, "meta.yaml")
    if os.path.exists(meta_path):
        output({"status": "Using cached CoreML model"})
        return meta_path

    output({"status": f"Converting {hf_model_name} to CoreML (this may take 10-30 min on first run)..."})

    # Find the ANEMLL convert script
    anemll_dir = find_anemll_package()
    if anemll_dir:
        convert_script = os.path.join(anemll_dir, "anemll", "utils", "convert_model.sh")
    else:
        # Try common install locations
        convert_script = None
        for candidate in [
            os.path.join(os.path.expanduser("~"), "Anemll", "anemll", "utils", "convert_model.sh"),
            os.path.join(os.path.expanduser("~"), "anemll", "anemll", "utils", "convert_model.sh"),
        ]:
            if os.path.exists(candidate):
                convert_script = candidate
                break

    if not convert_script or not os.path.exists(convert_script):
        raise RuntimeError(
            "ANEMLL convert_model.sh not found. "
            "Install ANEMLL: git clone https://github.com/Anemll/Anemll && cd Anemll && pip install -e ."
        )

    os.makedirs(output_dir, exist_ok=True)

    # Run conversion
    result = subprocess.run(
        [
            "bash", convert_script,
            "--model", hf_model_name,
            "--output", output_dir,
        ],
        capture_output=True,
        text=True,
        timeout=3600,  # 1 hour timeout
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"Model conversion failed (exit code {result.returncode}): "
            f"{result.stderr[:500] if result.stderr else 'No error output'}"
        )

    if not os.path.exists(meta_path):
        raise RuntimeError(
            f"Conversion completed but meta.yaml not found at {meta_path}"
        )

    output({"status": "CoreML model conversion complete"})
    return meta_path


def init_model(hf_model_name="google/gemma-3-4b-it", context_length=512):
    """Initialize ANEMLL model for ANE inference."""
    global _model, _tokenizer, _state, _causal_mask
    global _context_length, _metadata, _is_monolithic
    global _prefill_fn, _generate_fn, _batch_size

    _context_length = context_length

    try:
        import yaml
        import numpy as np
        import coremltools as ct
    except ImportError as e:
        output({
            "error": f"Missing dependency: {e}. "
            "Run: pip install anemll coremltools transformers pyyaml numpy torch"
        })
        return

    # Convert model to CoreML if needed
    safe_name = hf_model_name.replace("/", "_")
    output_dir = os.path.join(get_cache_dir(), safe_name)

    try:
        meta_path = convert_model_to_coreml(hf_model_name, output_dir, context_length)
    except Exception as e:
        output({"error": f"Model conversion failed: {e}"})
        return

    # Load meta.yaml
    output({"status": "Loading CoreML model onto ANE..."})
    try:
        with open(meta_path, "r") as f:
            meta = yaml.safe_load(f)
    except Exception as e:
        output({"error": f"Failed to load meta.yaml: {e}"})
        return

    params = meta.get("model_info", {}).get("parameters", {})
    _context_length = params.get("context_length", context_length)
    _batch_size = params.get("batch_size", 64)
    _metadata = meta

    # Load models using ANEMLL's utilities
    try:
        # Import ANEMLL inference functions
        # These are in the tests/chat.py or anemll package
        sys.path.insert(0, os.path.dirname(meta_path))

        from anemll.models.base_model import load_model
        from transformers import AutoTokenizer

        # Initialize tokenizer
        output({"status": "Loading tokenizer..."})
        _tokenizer = AutoTokenizer.from_pretrained(hf_model_name)

        # Check if monolithic model
        if "monolithic_model" in params:
            _is_monolithic = True
            model_path = os.path.join(output_dir, params["monolithic_model"])

            output({"status": "Loading monolithic CoreML model..."})
            _model = {
                "infer": load_model(model_path, function_name="infer"),
                "prefill": load_model(model_path, function_name="prefill"),
            }

            # Check for rotation support (Gemma 3 sliding window)
            if params.get("sliding_window"):
                _model["infer_rotate"] = load_model(model_path, function_name="infer_rotate")
                _model["prefill_rotate"] = load_model(model_path, function_name="prefill_rotate")
        else:
            _is_monolithic = False
            # Load chunked models
            _model = {"chunks": [], "embeddings": None, "lm_head": None}

            # Load embeddings
            emb_pattern = os.path.join(output_dir, "*embeddings*")
            emb_files = glob.glob(emb_pattern)
            if emb_files:
                _model["embeddings"] = load_model(emb_files[0])

            # Load FFN chunks
            chunk_pattern = os.path.join(output_dir, "*chunk*")
            chunk_files = sorted(glob.glob(chunk_pattern))
            for cf in chunk_files:
                _model["chunks"].append(load_model(cf))

            # Load LM head
            lmhead_pattern = os.path.join(output_dir, "*lm_head*")
            lmhead_files = glob.glob(lmhead_pattern)
            if lmhead_files:
                _model["lm_head"] = load_model(lmhead_files[0])

        # Create inference state
        from anemll.models.base_model import create_unified_state, initialize_causal_mask

        _state = create_unified_state(
            _model["chunks"] if not _is_monolithic else [_model["infer"]],
            _context_length,
            eval_mode=False,
            metadata=_metadata,
        )
        _causal_mask = initialize_causal_mask(_context_length)

        output({"ready": True, "context_length": _context_length, "monolithic": _is_monolithic})

    except ImportError as e:
        output({
            "error": f"ANEMLL not properly installed: {e}. "
            "Install: git clone https://github.com/Anemll/Anemll && cd Anemll && pip install -e ."
        })
    except Exception as e:
        output({"error": f"Failed to load model: {e}"})


def generate_text(prompt_text, max_tokens=256, temperature=0.1):
    """Generate text using the loaded ANEMLL model on ANE."""
    if _model is None or _tokenizer is None:
        return None, "Model not initialized"

    try:
        import numpy as np

        # Tokenize prompt
        input_ids_list = _tokenizer.encode(prompt_text)
        input_ids = np.zeros((1, _context_length), dtype=np.int32)

        prompt_len = min(len(input_ids_list), _context_length - max_tokens)
        input_ids[0, :prompt_len] = input_ids_list[:prompt_len]

        from anemll.models.base_model import (
            run_monolithic_prefill,
            generate_next_token_monolithic,
            run_prefill,
            generate_next_token,
        )

        # Reset state for new generation
        from anemll.models.base_model import create_unified_state
        state = create_unified_state(
            _model["chunks"] if not _is_monolithic else [_model["infer"]],
            _context_length,
            eval_mode=False,
            metadata=_metadata,
        )
        causal_mask = _causal_mask.copy()

        # Prefill phase
        if _is_monolithic:
            run_monolithic_prefill(
                _model["prefill"],
                input_ids,
                prompt_len,
                _context_length,
                _batch_size,
                state,
                causal_mask,
            )
        else:
            run_prefill(
                _model["embeddings"],
                _model["chunks"],
                _model["lm_head"],
                input_ids,
                prompt_len,
                _context_length,
                _batch_size,
                state,
                causal_mask,
            )

        # Generation phase
        generated_tokens = []
        pos = prompt_len
        eos_token_id = _tokenizer.eos_token_id

        for _ in range(max_tokens):
            if pos >= _context_length - 1:
                break

            if _is_monolithic:
                next_token = generate_next_token_monolithic(
                    _model["infer"],
                    input_ids,
                    pos,
                    _context_length,
                    _metadata,
                    state,
                    causal_mask,
                    temperature=temperature,
                )
            else:
                next_token = generate_next_token(
                    _model["embeddings"],
                    _model["chunks"],
                    _model["lm_head"],
                    input_ids,
                    pos,
                    _context_length,
                    _metadata,
                    state,
                    causal_mask,
                    temperature=temperature,
                )

            if next_token == eos_token_id:
                break

            input_ids[0, pos] = next_token
            generated_tokens.append(int(next_token))
            pos += 1

        # Decode generated tokens
        result = _tokenizer.decode(generated_tokens, skip_special_tokens=True)
        return result.strip(), None

    except Exception as e:
        return None, str(e)


def build_translation_prompt(text, from_lang, to_lang, context=None):
    """Build a translation prompt for the model."""
    lang_names = {"ja": "Japanese", "en": "English"}
    from_name = lang_names.get(from_lang, from_lang)
    to_name = lang_names.get(to_lang, to_lang)

    # Build context section if provided
    context_section = ""
    if context and context.get("previousSegments"):
        segments = context["previousSegments"][-3:]  # Last 3 segments
        context_section = "Previous translations for context:\n"
        for seg in segments:
            context_section += f"  {seg.get('source', '')} -> {seg.get('translated', '')}\n"
        context_section += "\n"

    # Build glossary section if provided
    glossary_section = ""
    if context and context.get("glossary"):
        entries = context["glossary"][:10]  # Max 10 glossary terms
        glossary_section = "Glossary (use these exact translations):\n"
        for entry in entries:
            glossary_section += f"  {entry['source']} -> {entry['target']}\n"
        glossary_section += "\n"

    prompt = (
        f"{context_section}{glossary_section}"
        f"Translate the following text from {from_name} to {to_name}. "
        f"Output only the translation, nothing else.\n\n{text}"
    )

    # Wrap with chat template if available
    if _tokenizer and hasattr(_tokenizer, "apply_chat_template"):
        try:
            messages = [{"role": "user", "content": prompt}]
            formatted = _tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            return formatted
        except Exception:
            pass

    return prompt


def translate(text, from_lang, to_lang, context=None):
    """Translate text using ANEMLL on ANE."""
    if not text or not text.strip():
        output({"translated": ""})
        return

    if from_lang == to_lang:
        output({"translated": text})
        return

    prompt = build_translation_prompt(text, from_lang, to_lang, context)
    result, error = generate_text(prompt, max_tokens=256, temperature=0.1)

    if error:
        output({"error": f"Translation failed: {error}"})
    elif result:
        # Clean up any leftover prompt artifacts
        cleaned = result.strip()
        output({"translated": cleaned})
    else:
        output({"translated": ""})


def dispose():
    """Release all model resources."""
    global _model, _tokenizer, _state, _causal_mask, _metadata
    _model = None
    _tokenizer = None
    _state = None
    _causal_mask = None
    _metadata = None
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
                    hf_model_name=msg.get("model", "google/gemma-3-4b-it"),
                    context_length=msg.get("context_length", 512),
                )
            elif action == "translate":
                translate(
                    msg.get("text", ""),
                    msg.get("from", "ja"),
                    msg.get("to", "en"),
                    msg.get("context"),
                )
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
