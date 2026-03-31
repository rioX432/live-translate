/// apple-stt: CLI bridge for Apple SpeechTranscriber (macOS 26+)
///
/// Usage:
///   apple-stt transcribe <audio-file> [--locale <locale>] [--json]
///   apple-stt list-locales
///
/// Outputs transcribed text to stdout. With --json, outputs JSON with
/// text and locale fields.
///
/// Requires macOS 26 (Tahoe) or later.

import Foundation
import Speech
import AVFoundation

// MARK: - CLI Argument Parsing

enum Command {
    case transcribe(path: String, locale: Locale, jsonOutput: Bool)
    case listLocales
    case help
}

func parseArguments() -> Command {
    let args = Array(CommandLine.arguments.dropFirst())

    guard let subcommand = args.first else {
        return .help
    }

    switch subcommand {
    case "transcribe":
        guard args.count >= 2 else {
            fputs("Error: missing audio file path\n", stderr)
            return .help
        }
        let path = args[1]
        var locale = Locale(identifier: "ja-JP")
        var jsonOutput = false

        var i = 2
        while i < args.count {
            switch args[i] {
            case "--locale":
                if i + 1 < args.count {
                    locale = Locale(identifier: args[i + 1])
                    i += 2
                } else {
                    fputs("Error: --locale requires a value\n", stderr)
                    i += 1
                }
            case "--json":
                jsonOutput = true
                i += 1
            default:
                i += 1
            }
        }

        return .transcribe(path: path, locale: locale, jsonOutput: jsonOutput)

    case "list-locales":
        return .listLocales

    default:
        return .help
    }
}

// MARK: - Transcription

@available(macOS 26.0, *)
func transcribe(audioPath: String, locale: Locale, jsonOutput: Bool) async throws {
    let url = URL(fileURLWithPath: audioPath)
    guard FileManager.default.fileExists(atPath: audioPath) else {
        fputs("Error: file not found: \(audioPath)\n", stderr)
        Foundation.exit(1)
    }

    // Ensure the language asset is available on-device
    let transcriber = SpeechTranscriber(locale: locale)
    let analyzer = SpeechAnalyzer(modules: [transcriber])

    // Download language model if needed (AssetInventory)
    let request = try await AssetInventory.assetInstallationRequest(
        supporting: [transcriber]
    )
    if let request {
        fputs("Downloading language model for \(locale.identifier)...\n", stderr)
        try await request.downloadAndInstall()
    }

    // Open the audio file
    let audioFile = try AVAudioFile(forReading: url)

    // Start the analyzer with the audio file
    try await analyzer.start(
        inputAudioFile: audioFile,
        finishAfterFile: true
    )

    // Collect transcription results
    var fullText = ""
    for try await result in transcriber.results {
        fullText += result.text
    }

    let trimmed = fullText.trimmingCharacters(in: .whitespacesAndNewlines)

    if jsonOutput {
        let output: [String: Any] = [
            "text": trimmed,
            "locale": locale.identifier
        ]
        if let data = try? JSONSerialization.data(withJSONObject: output),
           let json = String(data: data, encoding: .utf8) {
            print(json)
        }
    } else {
        print(trimmed)
    }
}

// MARK: - List Locales

@available(macOS 26.0, *)
func listLocales() async {
    let locales = await SpeechTranscriber.supportedLocales
    let identifiers = locales.map { $0.identifier }.sorted()
    for id in identifiers {
        print(id)
    }
}

// MARK: - Help

func printHelp() {
    let help = """
    apple-stt: CLI bridge for Apple SpeechTranscriber (macOS 26+)

    Usage:
      apple-stt transcribe <audio-file> [--locale <locale>] [--json]
      apple-stt list-locales
      apple-stt help

    Commands:
      transcribe    Transcribe an audio file to text
      list-locales  List supported locales for on-device transcription
      help          Show this help message

    Options:
      --locale <id>  Locale identifier (default: ja-JP)
      --json         Output JSON with text and locale fields

    Requirements:
      macOS 26 (Tahoe) or later
    """
    print(help)
}

// MARK: - Entry Point

if #available(macOS 26.0, *) {
    let command = parseArguments()

    switch command {
    case .transcribe(let path, let locale, let json):
        do {
            try await transcribe(audioPath: path, locale: locale, jsonOutput: json)
        } catch {
            fputs("Error: \(error.localizedDescription)\n", stderr)
            Foundation.exit(1)
        }
    case .listLocales:
        await listLocales()
    case .help:
        printHelp()
    }
} else {
    fputs("Error: apple-stt requires macOS 26 (Tahoe) or later\n", stderr)
    Foundation.exit(1)
}
