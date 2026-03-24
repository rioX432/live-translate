#!/usr/bin/env bash
# Generate STT benchmark test audio files using macOS `say` command.
# Creates 40 WAV files (20 JA, 20 EN) at 16kHz mono with a JSONL manifest.
#
# Usage: bash benchmark/scripts/generate-stt-testset.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCHMARK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${BENCHMARK_DIR}/testset/stt-audio"
MANIFEST="${BENCHMARK_DIR}/testset/stt-manifest.jsonl"

mkdir -p "$OUTPUT_DIR"
: > "$MANIFEST"

# macOS Japanese voice (Kyoko is pre-installed)
JA_VOICE="Kyoko"
# macOS English voice
EN_VOICE="Samantha"

# Check that `say` command is available (macOS only)
if ! command -v say &> /dev/null; then
  echo "ERROR: 'say' command not found. This script requires macOS."
  exit 1
fi

# Check that sox is available for WAV conversion
if ! command -v sox &> /dev/null; then
  echo "ERROR: 'sox' not found. Install with: brew install sox"
  exit 1
fi

# Helper: generate a single WAV file at 16kHz mono
# Args: $1=id $2=text $3=language $4=domain $5=voice
generate_audio() {
  local id="$1"
  local text="$2"
  local lang="$3"
  local domain="$4"
  local voice="$5"

  local aiff_path="${OUTPUT_DIR}/${id}.aiff"
  local wav_path="${OUTPUT_DIR}/${id}.wav"

  # Generate AIFF with macOS say
  say -v "$voice" -o "$aiff_path" "$text"

  # Convert to 16kHz mono WAV
  sox "$aiff_path" -r 16000 -c 1 -b 16 "$wav_path"
  rm -f "$aiff_path"

  # Append to manifest
  printf '{"id":"%s","audio_path":"stt-audio/%s.wav","reference_text":"%s","language":"%s","domain":"%s"}\n' \
    "$id" "$id" "$(echo "$text" | sed 's/"/\\"/g')" "$lang" "$domain" >> "$MANIFEST"

  echo "  Generated: ${id}.wav"
}

echo "=== Generating Japanese test audio (20 files) ==="

# Japanese - casual (6)
generate_audio "ja-casual-01" "おはようございます" "ja" "casual" "$JA_VOICE"
generate_audio "ja-casual-02" "今日はいい天気ですね" "ja" "casual" "$JA_VOICE"
generate_audio "ja-casual-03" "ありがとうございます" "ja" "casual" "$JA_VOICE"
generate_audio "ja-casual-04" "昨日の映画はとても面白かったです" "ja" "casual" "$JA_VOICE"
generate_audio "ja-casual-05" "週末に友達と買い物に行きました" "ja" "casual" "$JA_VOICE"
generate_audio "ja-casual-06" "最近ジムに通い始めました" "ja" "casual" "$JA_VOICE"

# Japanese - business (7)
generate_audio "ja-business-01" "本日はお忙しいところありがとうございます" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-02" "来週の会議の件でご連絡いたしました" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-03" "プロジェクトの進捗について報告いたします" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-04" "ご検討のほどよろしくお願いいたします" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-05" "第三四半期の売上は前年比で二十パーセント増加しました" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-06" "新しいマーケティング戦略を提案させていただきます" "ja" "business" "$JA_VOICE"
generate_audio "ja-business-07" "契約書の内容を確認させていただけますでしょうか" "ja" "business" "$JA_VOICE"

# Japanese - technical (7)
generate_audio "ja-technical-01" "このアプリケーションはリアルタイム音声認識を使用しています" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-02" "ニューラルネットワークの学習率を調整する必要があります" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-03" "データベースのインデックスを再構築してください" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-04" "メモリリークの原因を調査しています" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-05" "このライブラリはマルチスレッド処理に対応しています" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-06" "音声データは十六キロヘルツのサンプリングレートで録音されます" "ja" "technical" "$JA_VOICE"
generate_audio "ja-technical-07" "トランスフォーマーモデルの推論速度を最適化しました" "ja" "technical" "$JA_VOICE"

echo ""
echo "=== Generating English test audio (20 files) ==="

# English - casual (6)
generate_audio "en-casual-01" "Good morning, how are you?" "en" "casual" "$EN_VOICE"
generate_audio "en-casual-02" "The weather is really nice today" "en" "casual" "$EN_VOICE"
generate_audio "en-casual-03" "Thank you so much for your help" "en" "casual" "$EN_VOICE"
generate_audio "en-casual-04" "I watched a great movie last night" "en" "casual" "$EN_VOICE"
generate_audio "en-casual-05" "Let's grab some coffee this weekend" "en" "casual" "$EN_VOICE"
generate_audio "en-casual-06" "I just started learning Japanese" "en" "casual" "$EN_VOICE"

# English - business (7)
generate_audio "en-business-01" "Thank you for taking the time to meet with us today" "en" "business" "$EN_VOICE"
generate_audio "en-business-02" "I would like to discuss the quarterly results" "en" "business" "$EN_VOICE"
generate_audio "en-business-03" "We need to finalize the project timeline by Friday" "en" "business" "$EN_VOICE"
generate_audio "en-business-04" "Our revenue increased by twenty percent year over year" "en" "business" "$EN_VOICE"
generate_audio "en-business-05" "Please review the contract and provide your feedback" "en" "business" "$EN_VOICE"
generate_audio "en-business-06" "The marketing team has proposed a new campaign strategy" "en" "business" "$EN_VOICE"
generate_audio "en-business-07" "We should schedule a follow up meeting next week" "en" "business" "$EN_VOICE"

# English - technical (7)
generate_audio "en-technical-01" "This application uses real-time speech recognition" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-02" "We need to adjust the learning rate of the neural network" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-03" "Please rebuild the database indexes for better performance" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-04" "We are investigating a memory leak in the main process" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-05" "This library supports multi-threaded processing" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-06" "Audio data is recorded at a sixteen kilohertz sample rate" "en" "technical" "$EN_VOICE"
generate_audio "en-technical-07" "We optimized the transformer model inference speed" "en" "technical" "$EN_VOICE"

echo ""
echo "=== Done ==="
echo "Generated $(wc -l < "$MANIFEST" | tr -d ' ') audio files"
echo "Manifest: $MANIFEST"
echo "Audio dir: $OUTPUT_DIR"
