# live-translate

リアルタイム同時翻訳オーバーレイ Electron アプリ。

## Tech Stack

- Electron + React + TypeScript
- electron-vite (build)
- whisper-node-addon (STT)
- Google Cloud Translation API v2 (translation)

## Architecture

- `src/engines/types.ts` — 共通インターフェース (STTEngine, TranslatorEngine, E2ETranslationEngine)
- `src/pipeline/TranslationPipeline.ts` — Strategy パターンでエンジンを切替可能なパイプライン
- `src/main/` — Electron main process (2ウィンドウ: 設定 + 字幕)
- `src/renderer/` — React UI

## Commands

```bash
npm run dev      # 開発モード
npm run build    # ビルド
npm run package  # .app 生成
```

## Key Decisions

- Python 不要（whisper-node-addon でネイティブ統合）
- SeamlessM4T v2 は不採用（30GB超、Python必須で配布困難）
- 翻訳エンジンは Strategy パターンでプラグイン式に差し替え可能
- オフライン翻訳は Whisper translate task (JA→EN のみ)
