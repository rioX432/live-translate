#!/usr/bin/env bash
# Generate STT test audio files using macOS `say` command.
# Produces 20 JA and 20 EN WAV files at 16kHz mono with a JSONL manifest.
#
# Usage: ./benchmark/scripts/generate-stt-testset.sh
# Requires: macOS with `say` and `afconvert` commands

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../testset/stt"
MANIFEST="$OUTPUT_DIR/manifest.jsonl"

mkdir -p "$OUTPUT_DIR/audio"

# Clear previous manifest
> "$MANIFEST"

# Helper: generate a WAV file from text using macOS TTS
# Args: $1=id $2=text $3=language $4=voice $5=domain
generate() {
  local id="$1"
  local text="$2"
  local lang="$3"
  local voice="$4"
  local domain="$5"
  local aiff_path="$OUTPUT_DIR/audio/${id}.aiff"
  local wav_path="$OUTPUT_DIR/audio/${id}.wav"

  echo "  Generating: $id ($lang)"

  # Generate AIFF with macOS say
  say -v "$voice" -o "$aiff_path" "$text"

  # Convert to 16kHz mono 16-bit PCM WAV
  afconvert -f WAVE -d LEI16@16000 -c 1 "$aiff_path" "$wav_path"

  # Remove intermediate AIFF
  rm -f "$aiff_path"

  # Append to manifest
  printf '{"id":"%s","audio_path":"audio/%s.wav","reference_text":"%s","language":"%s","domain":"%s"}\n' \
    "$id" "$id" "$(echo "$text" | sed 's/"/\\"/g')" "$lang" "$domain" >> "$MANIFEST"
}

echo "=== Generating Japanese test audio ==="

# JA casual sentences
generate "ja-casual-01" "おはようございます。" "ja" "Kyoko" "casual"
generate "ja-casual-02" "ありがとうございます。" "ja" "Kyoko" "casual"
generate "ja-casual-03" "今日はいい天気ですね。" "ja" "Kyoko" "casual"
generate "ja-casual-04" "お腹がすきました。" "ja" "Kyoko" "casual"
generate "ja-casual-05" "お元気ですか。" "ja" "Kyoko" "casual"

# JA business sentences
generate "ja-business-01" "本日の会議は午後三時から始まります。" "ja" "Kyoko" "business"
generate "ja-business-02" "先日のご提案について確認させてください。" "ja" "Kyoko" "business"
generate "ja-business-03" "来月の売上目標は前年比百二十パーセントです。" "ja" "Kyoko" "business"
generate "ja-business-04" "プロジェクトの進捗を報告いたします。" "ja" "Kyoko" "business"
generate "ja-business-05" "契約書の内容をご確認ください。" "ja" "Kyoko" "business"

# JA technical sentences
generate "ja-technical-01" "このシステムはマイクロサービスアーキテクチャを採用しています。" "ja" "Kyoko" "technical"
generate "ja-technical-02" "データベースのインデックスを再構築する必要があります。" "ja" "Kyoko" "technical"
generate "ja-technical-03" "エーピーアイのレスポンスタイムが遅延しています。" "ja" "Kyoko" "technical"
generate "ja-technical-04" "テスト環境にデプロイが完了しました。" "ja" "Kyoko" "technical"
generate "ja-technical-05" "メモリリークの原因を特定しました。" "ja" "Kyoko" "technical"

# JA longer sentences
generate "ja-long-01" "昨日の夜、友達と一緒にレストランで晩ご飯を食べましたが、料理がとてもおいしかったです。" "ja" "Kyoko" "casual"
generate "ja-long-02" "この新しいソフトウェアを導入することで、業務効率を大幅に改善できると考えています。" "ja" "Kyoko" "business"
generate "ja-long-03" "機械学習モデルの精度を向上させるために、より多くのトレーニングデータが必要です。" "ja" "Kyoko" "technical"
generate "ja-long-04" "東京駅から新幹線に乗って、大阪まで約二時間半で到着します。" "ja" "Kyoko" "casual"
generate "ja-long-05" "セキュリティパッチを適用した後、全てのサービスを再起動してください。" "ja" "Kyoko" "technical"

echo ""
echo "=== Generating English test audio ==="

# EN casual sentences
generate "en-casual-01" "Good morning, how are you today?" "en" "Samantha" "casual"
generate "en-casual-02" "Thank you very much for your help." "en" "Samantha" "casual"
generate "en-casual-03" "The weather is really nice today." "en" "Samantha" "casual"
generate "en-casual-04" "I'm looking forward to the weekend." "en" "Samantha" "casual"
generate "en-casual-05" "Let's grab lunch together sometime." "en" "Samantha" "casual"

# EN business sentences
generate "en-business-01" "The quarterly earnings report will be released next week." "en" "Samantha" "business"
generate "en-business-02" "We need to schedule a follow-up meeting with the client." "en" "Samantha" "business"
generate "en-business-03" "Our revenue increased by fifteen percent this quarter." "en" "Samantha" "business"
generate "en-business-04" "Please review the updated proposal and share your feedback." "en" "Samantha" "business"
generate "en-business-05" "The project deadline has been extended to the end of March." "en" "Samantha" "business"

# EN technical sentences
generate "en-technical-01" "The application uses a microservices architecture with Docker containers." "en" "Samantha" "technical"
generate "en-technical-02" "We need to rebuild the database indexes to improve query performance." "en" "Samantha" "technical"
generate "en-technical-03" "The API response time has increased significantly since the last deployment." "en" "Samantha" "technical"
generate "en-technical-04" "The continuous integration pipeline is failing due to a dependency conflict." "en" "Samantha" "technical"
generate "en-technical-05" "We identified a memory leak in the event handler module." "en" "Samantha" "technical"

# EN longer sentences
generate "en-long-01" "Last night I went out to dinner with some friends at a new Italian restaurant, and the food was absolutely delicious." "en" "Samantha" "casual"
generate "en-long-02" "By implementing this new software solution, we expect to significantly improve our operational efficiency and reduce costs." "en" "Samantha" "business"
generate "en-long-03" "To improve the accuracy of our machine learning model, we need to collect more diverse training data from multiple sources." "en" "Samantha" "technical"
generate "en-long-04" "The train from Tokyo Station to Osaka takes approximately two and a half hours on the bullet train." "en" "Samantha" "casual"
generate "en-long-05" "After applying the security patches, please restart all services and verify that the system is functioning correctly." "en" "Samantha" "technical"

echo ""
echo "=== Generation complete ==="
echo "Audio files: $OUTPUT_DIR/audio/"
echo "Manifest: $MANIFEST"
echo "Total: $(wc -l < "$MANIFEST") entries"
