# リアルタイム同時翻訳ツール 技術調査レポート

調査日: 2026-03-16

## 目的

多言語環境でのプレゼンテーション中に、Mac拡張ディスプレイ上でリアルタイム字幕翻訳を表示する。日本語↔英語の自動切替が必要。文字起こしログも残したい。

## 要件

- 日本語↔英語のリアルタイム翻訳（レイテンシ2秒以内）
- 言語の自動検出・自動切替（話者が変わっても対応）
- Mac拡張ディスプレイ上でスライドに重ねて字幕表示
- 翻訳精度が高い（ビジネス会議レベル）
- 文字起こしログ保存
- なるべくコストをかけない

---

## 1. 既存ツール比較

### ビデオ会議プラットフォーム

| ツール | 翻訳機能 | 日本語対応 | 料金 | 備考 |
|---|---|---|---|---|
| Google Meet 字幕翻訳 | 69言語字幕翻訳 | ○ | Business Standard以上 + Geminiアドオン | 2025/1以降Gemini必須 |
| Google Meet 音声翻訳 | 6言語音声翻訳 | ✗ | Business Plus以上 | 日本語未対応 |
| MS Teams AI Interpreter | 9言語音声同時通訳 | ○ | Copilot($4,500/月/人) | 高額 |
| Zoom 翻訳字幕 | 35言語字幕 | ○ | 月750円オプション | 安い |

### 専用翻訳ツール

| ツール | 料金 | 日本語 | 特徴 |
|---|---|---|---|
| Sentio (ポケトーク) | 月3,300円/500人 | ○ | コスパ最強、無料枠30分/月 |
| VoicePing | 無料〜月20,000円 | ○ | 日本製、Whisper V2ベース |
| DeepL Voice | 最低50ライセンス | ○ | 翻訳精度最高、中小には敷居高い |
| Felo Subtitles (Chrome拡張) | 無料あり | ○ | 即効策として有効 |

### Chrome拡張（Google Meet向け）

| 拡張 | 特徴 | リスク |
|---|---|---|
| Felo Subtitles | リアルタイム翻訳、無料 | DOMスクレイピング、UI変更で壊れる |
| JotMe | 77言語、議事録生成 | 同上 |
| ELI | 無制限無料 | Google Meet専用 |

---

## 2. 音声認識 (STT) 技術比較

### クラウドAPI

| サービス | レイテンシ | 日本語精度 | 料金(/分) | ストリーミング | コードスイッチング |
|---|---|---|---|---|---|
| Google Cloud STT | ~300ms | 高 (CER 2.7%) | $0.024 | ○ | 最大3言語指定 |
| Deepgram Nova-3 | <300ms | 中〜高 | $0.0043 | ○ | **10言語ネイティブ対応** |
| Azure Speech | ~300ms | 高 | $0.017 | ○ | △ |
| OpenAI Whisper API | バッチのみ | 高 | $0.006 | ✗ | ✗ |

### ローカルモデル

| モデル | 速度 | 日本語精度 | コスト | 備考 |
|---|---|---|---|---|
| **Kotoba-Whisper v2.0** | large-v3の6.3倍速 | 最高（日本語特化） | ¥0 | 英語混在は非対応 |
| **Lightning Whisper MLX** | whisper.cppの10倍速 | 高 | ¥0 | Apple Silicon最適化 |
| Whisper large-v3-turbo | large-v3の2倍速 | 高（v2同等） | ¥0 | 809Mパラメータ |
| whisper.cpp (medium) | ~2秒/チャンク | 90%以上 | ¥0 | Metal対応 |
| **VoicePing whisper-ja-en** | large-v3の4倍速 | 高 | ¥0 | **日英双方向翻訳内蔵** |

### Web Speech API（不採用）

- 60秒タイムアウト、無音7秒で停止
- 先行事例が「barely working」
- 音声がGoogleに送信（プライバシー懸念）
- プロダクション利用には不安定

---

## 3. 翻訳技術比較

### 翻訳API

| サービス | 日英品質 | 短文精度 | レイテンシ | 無料枠 | リアルタイム適性 |
|---|---|---|---|---|---|
| **Google Translation** | 高い | **良好** | 100-300ms | 月50万文字 | ★★★ |
| DeepL API | 最高 | やや弱い | ms | 月50万文字(600文字/分制限) | ★★☆ |
| GPT-4o | 最高 | 良好 | 秒 | なし | ★☆☆ |
| Claude | 最高(WMT24) | 良好 | 秒 | なし | ★☆☆ |

**重要**: リアルタイム翻訳は短文を連続で翻訳するため、**短文精度とレイテンシ**が重要。DeepLは長文向けに最適化されており短文で誤訳が出やすい。Google Translationのほうがリアルタイム用途に適している。

### ローカル翻訳モデル

| モデル | 品質 | コスト | 備考 |
|---|---|---|---|
| M2M100 | 中 | ¥0 | LocalVocalが採用、MIT |
| OPUS-MT | 中 | ¥0 | CTranslate2で高速化可能 |
| LibreTranslate | 低〜中 | ¥0 | プロ用途には不十分 |
| **VoicePing whisper-ja-en** | 高 | ¥0 | STTと翻訳が一体 |

---

## 4. 日本語↔英語の自動言語切替

### 方式比較

| 方式 | 仕組み | 精度 | コスト |
|---|---|---|---|
| **VoicePing whisper-ja-en** | VAD分割→言語検出→双方向翻訳 | 高 | ¥0 |
| **Deepgram Nova-3 multi** | 統一マルチリンガルモデル | 最高 | $26/月 |
| Whisper VAD分割方式 | セグメント毎にdetect_language() | 中 | ¥0 |
| Google STT multi | 最大3言語指定 | 中〜高 | 有料 |

### Whisperの言語検出の制限

- 最初の30秒で言語判定、セグメント単位の切替は標準機能にない
- Kotoba-Whisperは日本語特化で英語が破綻する
- ワークアラウンド: VADで分割→各セグメントでdetect_language()→言語指定で書き起こし

---

## 5. Mac字幕オーバーレイ表示

### ユースケース

```
発表者のMac → HDMI/拡張ディスプレイ → プロジェクター
メインディスプレイ: 発表者操作用
拡張ディスプレイ: スライド + 字幕オーバーレイ（聴衆向け）
```

### 方式

| 方式 | 透過ウィンドウ | 安定性 | 開発工数 |
|---|---|---|---|
| **Electron** | ○ (transparent+frameless) | 高 | 低 |
| SwiftUI + AppKit | ○ | 最高 | 中 |
| Tauri v2 | △（バグ報告あり） | 中 | 低 |

### 参考OSS

| プロジェクト | 概要 | 技術 |
|---|---|---|
| **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** | 最も完成度の高いElectron翻訳アプリ | Electron+React, 7AIプロバイダ |
| [electron-speech-to-speech](https://github.com/Kutalia/electron-speech-to-speech) | 100%ローカル翻訳 | Whisper WebGPU + VITS |
| [OBS LocalVocal](https://github.com/royshil/obs-localvocal) | OBSプラグイン字幕 | whisper.cpp + M2M100 |

---

## 6. 推奨アーキテクチャ

### 構成A: VoicePing モデル方式（推奨・無料）

```
マイク → VAD → 言語検出 → VoicePing whisper-ja-en モデル → Electron透過ウィンドウ
                              (STT + 翻訳を1モデルで)

日本語発話 → 英語テキスト出力
英語発話 → 日本語テキスト出力
+ 原文テキストも同時表示
```

- コスト: ¥0
- 言語切替: セグメント単位で自動
- レイテンシ: ~1-2秒
- VoicePingが商用利用で実績あり

### 構成B: Whisper STT + Google Translation（精度重視）

```
マイク → VAD → Whisper large-v3-turbo (言語検出+STT)
  → 日本語検出 → Google Translation → 英語テキスト
  → 英語検出 → Google Translation → 日本語テキスト
→ Electron透過ウィンドウ
```

- コスト: ¥0（Google Translation月50万文字無料枠内）
- 翻訳精度: 高い（Google NMT、短文に強い）
- レイテンシ: ~2秒
- 言語拡張が容易

### 構成C: OBS LocalVocal（開発ゼロ・検証用）

```
OBS Studio + LocalVocal プラグイン → 字幕オーバーレイ → プロジェクター
```

- コスト: ¥0、開発不要
- 翻訳精度: 中（M2M100）
- 即日検証可能

---

## 7. コスト比較

| 構成 | STT | 翻訳 | 月額合計 |
|---|---|---|---|
| A: VoicePing モデル | ¥0 | ¥0（内蔵） | **¥0** |
| B: Whisper + Google | ¥0 | ¥0（50万文字以内） | **¥0** |
| B: Whisper + Google（超過時） | ¥0 | $20/100万文字 | **~$10-20** |
| C: OBS LocalVocal | ¥0 | ¥0 | **¥0** |
| 参考: Deepgram + DeepL Pro | $26/月 | $5.49+従量 | **~$40-60** |

---

## 8. 開発ロードマップ

### Step 1: 検証（今日）
- [ ] OBS LocalVocal をインストールして翻訳精度を体感
- [ ] Sokuji を動かしてElectron翻訳アプリの動作感を確認

### Step 2: 技術検証（今週）
- [ ] VoicePing whisper-ja-en モデルの日英翻訳精度を検証
- [ ] Apple Silicon Mac でのリアルタイム推論速度を計測
- [ ] Whisper large-v3-turbo の言語自動検出精度を検証

### Step 3: MVP開発（1-2週間）
- [ ] Electron + React プロジェクト作成
- [ ] マイク音声取得 + VAD
- [ ] VoicePing モデル統合（or Whisper + Google Translation）
- [ ] 透過字幕ウィンドウ（拡張ディスプレイ配置）
- [ ] 文字起こしログ保存

### Step 4: 改善
- [ ] 字幕UI調整（フォント、位置、フェードアウト）
- [ ] 精度が不足なら構成B（Google Translation）に切替
- [ ] Notion API連携（議事録保存）
- [ ] Claudeで議事録要約（各自のサブスクで手動）

---

## 参考リンク

### OSS
- [Sokuji](https://github.com/kizuna-ai-lab/sokuji) - Electron翻訳アプリ
- [VoicePing whisper-ja-en](https://github.com/voiceping-ai/whisper-ja-en-speech-translation) - 日英双方向翻訳モデル
- [OBS LocalVocal](https://github.com/royshil/obs-localvocal) - OBS字幕プラグイン
- [whisper-node-addon](https://github.com/Kutalia/whisper-node-addon) - Electron用Whisperネイティブアドオン
- [Lightning Whisper MLX](https://github.com/mustafaaljadery/lightning-whisper-mlx) - Apple Silicon最適化
- [Kotoba-Whisper v2.0](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0) - 日本語特化Whisper
- [WhisperLive](https://github.com/collabora/WhisperLive) - リアルタイムWhisper
- [Meta SeamlessStreaming](https://github.com/facebookresearch/seamless_communication) - E2E翻訳

### 商用サービス
- [Deepgram Nova-3](https://deepgram.com/) - 多言語コードスイッチング
- [Google Cloud Translation](https://cloud.google.com/translate) - 月50万文字無料
- [DeepL API](https://www.deepl.com/pro-api) - 翻訳品質最高
