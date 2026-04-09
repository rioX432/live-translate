import Foundation
import FluidAudio

/// JSON-over-stdio bridge for FluidAudio speaker diarization.
///
/// Protocol:
/// - Reads JSON commands from stdin (one per line)
/// - Writes JSON responses to stdout (one per line)
/// - Each request has a `_reqId` field echoed back in the response
///
/// Commands:
///   {"action": "init", "threshold": 0.6, "_reqId": 0}
///     → {"status": "ready", "_reqId": 0}
///
///   {"action": "diarize", "audioPath": "/tmp/chunk.wav", "_reqId": 1}
///     → {"speakerLabel": "Speaker 1", "speakerIndex": 0, "confidence": 0.85, "_reqId": 1}
///     → {"speakerLabel": null, "_reqId": 1}  (no speaker detected)
///
///   {"action": "dispose", "_reqId": 2}
///     → (process exits)

@MainActor
final class DiarizationBridge {
    private var manager: OfflineDiarizerManager?
    private var speakerMap: [String: Int] = [:]
    private var nextSpeakerIndex = 0

    func run() async {
        // Read lines from stdin
        while let line = readLine(strippingNewline: true) {
            guard !line.isEmpty else { continue }

            guard let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                writeError("Invalid JSON", reqId: nil)
                continue
            }

            let reqId = json["_reqId"] as? Int
            let action = json["action"] as? String ?? ""

            switch action {
            case "init":
                await handleInit(json: json, reqId: reqId)
            case "diarize":
                await handleDiarize(json: json, reqId: reqId)
            case "dispose":
                writeResponse(["status": "disposed"], reqId: reqId)
                exit(0)
            default:
                writeError("Unknown action: \(action)", reqId: reqId)
            }
        }
    }

    private func handleInit(json: [String: Any], reqId: Int?) async {
        let threshold = json["threshold"] as? Double ?? 0.6

        writeResponse(["status": "Downloading FluidAudio models (~32MB)..."], reqId: nil)

        do {
            let config = OfflineDiarizerConfig(
                clusteringThreshold: Float(threshold)
            )
            let mgr = OfflineDiarizerManager(config: config)
            try await mgr.prepareModels()
            self.manager = mgr
            writeResponse(["status": "ready"], reqId: reqId)
        } catch {
            writeError("Init failed: \(error.localizedDescription)", reqId: reqId)
        }
    }

    private func handleDiarize(json: [String: Any], reqId: Int?) async {
        guard let manager = self.manager else {
            writeError("Not initialized", reqId: reqId)
            return
        }

        guard let audioPath = json["audioPath"] as? String else {
            writeError("Missing audioPath", reqId: reqId)
            return
        }

        let url = URL(fileURLWithPath: audioPath)
        guard FileManager.default.fileExists(atPath: audioPath) else {
            writeError("File not found: \(audioPath)", reqId: reqId)
            return
        }

        do {
            let result = try await manager.process(url)

            // Find the dominant speaker (longest total duration)
            guard !result.segments.isEmpty else {
                writeResponse(["speakerLabel": NSNull(), "confidence": 0.0], reqId: reqId)
                return
            }

            var speakerDurations: [String: Double] = [:]
            for segment in result.segments {
                let dur = segment.endTimeSeconds - segment.startTimeSeconds
                speakerDurations[segment.speakerId, default: 0] += dur
            }

            guard let dominantSpeaker = speakerDurations.max(by: { $0.value < $1.value }) else {
                writeResponse(["speakerLabel": NSNull(), "confidence": 0.0], reqId: reqId)
                return
            }

            // Map raw speaker ID to a stable index
            let speakerIndex: Int
            if let existing = speakerMap[dominantSpeaker.key] {
                speakerIndex = existing
            } else {
                speakerIndex = nextSpeakerIndex
                speakerMap[dominantSpeaker.key] = speakerIndex
                nextSpeakerIndex += 1
            }

            let totalDuration = speakerDurations.values.reduce(0, +)
            let confidence = totalDuration > 0 ? dominantSpeaker.value / totalDuration : 0.0

            let label = "Speaker \(speakerIndex + 1)"
            writeResponse([
                "speakerLabel": label,
                "speakerIndex": speakerIndex,
                "confidence": min(1.0, confidence)
            ], reqId: reqId)
        } catch {
            writeError("Diarization failed: \(error.localizedDescription)", reqId: reqId)
        }
    }

    private func writeResponse(_ dict: [String: Any], reqId: Int?) {
        var response = dict
        if let reqId = reqId {
            response["_reqId"] = reqId
        }
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              let str = String(data: data, encoding: .utf8) else { return }
        print(str)
        fflush(stdout)
    }

    private func writeError(_ message: String, reqId: Int?) {
        writeResponse(["error": message], reqId: reqId)
    }
}

let bridge = DiarizationBridge()
await bridge.run()
