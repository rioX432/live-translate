# live-translate アーキテクチャ（改訂版 v2）

## 概要

Mac上で動作するリアルタイム同時翻訳オーバーレイアプリ。
プレゼン中に拡張ディスプレイ上でスライドに重ねて翻訳字幕を表示する。

**改訂理由**: SeamlessM4T v2 がモデル30GB超・Python必須で現実的でないため、Python不要の純Electronアプリに設計変更。

## 技術スタック

- **フレームワーク**: Electron + React + TypeScript
- **ビルド**: electron-vite
- **STT**: whisper-node-addon (whisper.cpp のNode.js ネイティブアドオン)
- **翻訳(オンライン)**: Google Cloud Translation API v2 (REST)
- **翻訳(オフライン)**: Whisper translate task (JA→EN のみ)
- **Python**: **不要**

## システム構成図

```
┌───────────────────────────────────────────────────────┐
│  Electron App (Python不要)                             │
│                                                         │
│  ┌──────────────┐                                      │
│  │ AudioCapture │ (Web Audio API, getUserMedia)        │
│  │ 16kHz PCM32  │                                      │
│  └──────┬───────┘                                      │
│         │                                              │
│         ▼                                              │
│  ┌──────────────────────────────────────────────┐      │
│  │ TranslationPipeline (Strategy Pattern)       │      │
│  │                                              │      │
│  │  Mode A: Cascade (Online)                    │      │
│  │  ┌─────────────┐   ┌──────────────────┐     │      │
│  │  │ WhisperLocal│──→│ GoogleTranslator │     │      │
│  │  │ (STT+LangDet)│  │ (REST API)       │     │      │
│  │  └─────────────┘   └──────────────────┘     │      │
│  │                                              │      │
│  │  Mode B: E2E (Offline, JA→EN only)           │      │
│  │  ┌────────────────────────┐                  │      │
│  │  │ WhisperTranslate       │                  │      │
│  │  │ (translate task)       │                  │      │
│  │  └────────────────────────┘                  │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                  │
│         ┌───────────┴───────────┐                      │
│         ▼                       ▼                      │
│  ┌──────────────┐    ┌──────────────────┐              │
│  │ SubtitleOver │    │ TranscriptLogger │              │
│  │ (透過Window) │    │ (ファイル保存)    │              │
│  └──────────────┘    └──────────────────┘              │
└───────────────────────────────────────────────────────┘
```

## ディレクトリ構成

```
live-translate/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── index.ts                   # エントリポイント
│   │   └── window.ts                  # ウィンドウ管理（メイン+字幕）
│   │
│   ├── renderer/                      # Electron renderer process
│   │   ├── App.tsx                    # React ルート
│   │   ├── components/
│   │   │   ├── SubtitleOverlay.tsx    # 字幕表示UI
│   │   │   └── SettingsPanel.tsx      # 設定画面
│   │   └── hooks/
│   │       ├── useAudioCapture.ts     # マイク音声取得
│   │       └── usePipeline.ts         # パイプライン管理
│   │
│   ├── engines/                       # プラグインエンジン
│   │   ├── types.ts                   # 共通インターフェース定義
│   │   ├── stt/
│   │   │   └── WhisperLocalEngine.ts  # Whisper STT (whisper-node-addon)
│   │   ├── translator/
│   │   │   └── GoogleTranslator.ts    # Google Cloud Translation
│   │   └── e2e/
│   │       └── WhisperTranslateEngine.ts  # Whisper translate (JA→EN)
│   │
│   ├── pipeline/
│   │   └── TranslationPipeline.ts     # STT→翻訳パイプライン
│   │
│   └── logger/
│       └── TranscriptLogger.ts        # 文字起こしログ保存
│
├── models/                            # Whisper GGMLモデル（初回DL）
├── logs/                              # 文字起こしログ出力先
├── package.json
├── electron-builder.yml
├── ARCHITECTURE.md
└── RESEARCH.md
```

## エンジンインターフェース

```typescript
// engines/types.ts

interface STTResult {
  text: string;
  language: 'ja' | 'en';
  isFinal: boolean;
  timestamp: number;
}

interface STTEngine {
  readonly id: string;
  readonly name: string;
  readonly isOffline: boolean;
  initialize(): Promise<void>;
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null>;
  dispose(): Promise<void>;
}

interface TranslatorEngine {
  readonly id: string;
  readonly name: string;
  readonly isOffline: boolean;
  initialize(): Promise<void>;
  translate(text: string, from: 'ja' | 'en', to: 'ja' | 'en'): Promise<string>;
  dispose(): Promise<void>;
}

interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLanguage: 'ja' | 'en';
  targetLanguage: 'ja' | 'en';
  timestamp: number;
}

interface E2ETranslationEngine {
  readonly id: string;
  readonly name: string;
  readonly isOffline: boolean;
  initialize(): Promise<void>;
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null>;
  dispose(): Promise<void>;
}

interface EngineConfig {
  mode: 'cascade' | 'e2e';
  sttEngineId?: string;
  translatorEngineId?: string;
  e2eEngineId?: string;
}
```

## 動作モード

### Mode A: オンライン（推奨）
```
Whisper STT (ローカル) → 言語検出 → Google Translation API → 字幕
```
- 日英双方向対応
- 翻訳品質: 高
- コスト: ¥0（月50万文字無料枠）
- 要: インターネット + Google Cloud API Key

### Mode B: オフライン
```
Whisper translate task → 字幕
```
- JA→EN のみ対応（EN→JA は不可）
- 翻訳品質: 中
- コスト: ¥0
- インターネット不要

## 新しいエンジンの追加方法

1ファイル追加するだけ:

```typescript
// 例: 将来 DeepL を追加する場合
// src/engines/translator/DeepLTranslator.ts
class DeepLTranslator implements TranslatorEngine {
  readonly id = 'deepl';
  readonly name = 'DeepL API';
  readonly isOffline = false;
  async initialize() { /* ... */ }
  async translate(text, from, to) { /* ... */ }
  async dispose() { /* ... */ }
}
```

## 将来のエンジン候補（プラグインとして追加可能）

| エンジン | 種別 | Python要否 | 備考 |
|---|---|---|---|
| SeamlessM4T v2 | E2E | 必要 | 30GB超、将来Python同梱で対応 |
| DeepL API | Translator | 不要 | 月$5.49〜 |
| VoicePing whisper-ja-en | E2E | 必要 | 756M、日英特化 |
| Deepgram Nova-3 | STT | 不要 | $26/月、コードスイッチング対応 |

## 配布

- macOS arm64 向け .app ファイル
- Python **不要**（純Electronアプリ）
- Whisper モデル (~800MB) は初回起動時に自動ダウンロード
- 社内ファイル共有 or GitHub Private Releases で配布
- Apple Developer Program 不要（社内配布のため署名なし）

## 必要なマシンスペック

| 項目 | 要件 |
|---|---|
| Mac | Apple Silicon (M1以上) |
| RAM | 16GB以上推奨 |
| ストレージ | 1GB空き（モデル保存用） |
| macOS | 13 Ventura 以上 |
| ネットワーク | オンラインモード時のみ必要 |
