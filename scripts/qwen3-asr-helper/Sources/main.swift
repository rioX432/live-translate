// Resident Qwen3-ASR process for live-translate.
//
// Usage: qwen3-asr-helper <model directory>
//
// stdout carries one JSON object per line and nothing else:
//   startup:  {"ready":true}  or  {"fatal":"..."} followed by exit 1
//   request:  {"id":<int>,"pcm_f32_b64":"<16 kHz mono float32 little-endian>","context":"..."} on stdin
//             context is optional: glossary terms the model is biased towards
//   reply:    {"id":<int>,"text":"...","language":"Japanese","ms":<number>}
//             {"id":<int>,"error":"..."}
// Transcripts never go to stderr: meeting audio may be confidential.

import Foundation
@preconcurrency import MLX
import MLXAudioSTT

private func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

private func logError(_ message: String) {
    FileHandle.standardError.write(Data(("[qwen3-asr-helper] " + message + "\n").utf8))
}

private func decodePCM(_ base64: String) -> [Float]? {
    guard let data = Data(base64Encoded: base64), data.count % MemoryLayout<Float>.size == 0 else {
        return nil
    }
    return data.withUnsafeBytes { raw in
        Array(raw.bindMemory(to: Float.self))
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    emit(["fatal": "usage: qwen3-asr-helper <model directory>"])
    exit(1)
}

let model: Qwen3ASRModel
do {
    model = try await Qwen3ASRModel.fromModelDirectory(URL(fileURLWithPath: arguments[1], isDirectory: true))
} catch {
    emit(["fatal": "model load failed: \(error)"])
    exit(1)
}

// The first decode compiles Metal kernels; pay that before reporting ready.
_ = model.generate(audio: MLXArray([Float](repeating: 0, count: 16_000)), temperature: 0.0)
emit(["ready": true])

while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = request["id"] as? Int else {
        logError("ignored malformed request")
        continue
    }
    guard let base64 = request["pcm_f32_b64"] as? String, let samples = decodePCM(base64) else {
        emit(["id": id, "error": "invalid pcm_f32_b64"])
        continue
    }
    if samples.isEmpty {
        emit(["id": id, "text": "", "language": "", "ms": 0])
        continue
    }

    // Qwen3-ASR places this text in the system turn, the same slot the official
    // qwen_asr `context` argument uses, so terms bias recognition without forcing them.
    let context = request["context"] as? String ?? ""

    let start = Date()
    // Greedy decoding, and no forced language so the model reports the language it heard.
    let output = model.generate(audio: MLXArray(samples), temperature: 0.0, context: context)
    let ms = Date().timeIntervalSince(start) * 1000
    emit([
        "id": id,
        "text": output.text,
        "language": output.language ?? "",
        "ms": ms,
    ])
}
