#!/usr/bin/env bash
# Build the Apple Silicon Qwen3-ASR helper into resources/bin/qwen3-asr-helper/,
# which electron-builder ships as extraResources.
#
# xcodebuild, not `swift build`: only Xcode compiles MLX's Metal kernels into
# mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib, which the helper loads
# at runtime (see Agents.md in mlx-audio-swift).
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "qwen3-asr-helper needs macOS on Apple Silicon; skipping" >&2
  exit 0
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$root/scripts/qwen3-asr-helper"
derived="$pkg/.build/xcode"
out="$root/resources/bin/qwen3-asr-helper"

(cd "$pkg" && xcodebuild build \
  -scheme qwen3-asr-helper \
  -destination 'platform=macOS,arch=arm64' \
  -configuration Release \
  -derivedDataPath "$derived" \
  -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO)

products="$derived/Build/Products/Release"
rm -rf "$out"
mkdir -p "$out"
cp "$products/qwen3-asr-helper" "$out/"
cp -R "$products/mlx-swift_Cmlx.bundle" "$out/"
# MLX also looks for mlx.metallib next to the executable; ship both locations.
cp "$products/mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib" "$out/mlx.metallib"
echo "built $out"
