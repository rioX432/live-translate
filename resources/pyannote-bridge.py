#!/usr/bin/env python3
"""
Python subprocess bridge for pyannote.audio speaker diarization.
Receives audio file paths via stdin, outputs speaker segments as JSON via stdout.

Protocol:
  Input: {"action": "init", "auth_token": "hf_xxx"}
  Input: {"action": "diarize", "audio_path": "/tmp/audio.wav", "_reqId": 0}
  Input: {"action": "dispose"}
  Output: {"ready": true, "_reqId": ...}
  Output: {"speakers": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5}], "_reqId": ...}
  Output: {"error": "...", "_reqId": ...}
"""
import sys
import json

pipeline = None
_current_req_id = None

def output(data):
    if _current_req_id is not None:
        data["_reqId"] = _current_req_id
    print(json.dumps(data), flush=True)

def init_model(auth_token=None):
    global pipeline
    try:
        from pyannote.audio import Pipeline
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=auth_token
        )
        output({"ready": True})
    except ImportError:
        output({"error": "pyannote.audio not installed. Run: pip install pyannote.audio"})
    except Exception as e:
        output({"error": str(e)})

def diarize(audio_path):
    global pipeline
    if not pipeline:
        output({"error": "Pipeline not initialized"})
        return

    try:
        diarization = pipeline(audio_path)
        speakers = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speakers.append({
                "speaker": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3)
            })
        output({"speakers": speakers})
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
                init_model(msg.get("auth_token"))
            elif action == "diarize":
                diarize(msg["audio_path"])
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
