/// apple-translate: CLI bridge for Apple Translation framework (macOS 15+)
///
/// Modes:
///   apple-translate daemon    — JSON-over-stdio daemon (one JSON per line)
///   apple-translate translate <text> --from <lang> --to <lang> [--json]
///   apple-translate languages
///   apple-translate help
///
/// Daemon protocol (stdin → stdout, newline-delimited JSON):
///   Request:  {"action":"translate","text":"...","from":"ja","to":"en","_reqId":1}
///   Response: {"translated":"...","from":"ja","to":"en","_reqId":1}
///   Error:    {"error":"...","_reqId":1}
///
///   Request:  {"action":"languages","_reqId":2}
///   Response: {"languages":["ja","en","zh",...],"_reqId":2}
///
///   Request:  {"action":"dispose"}
///   (process exits gracefully)
///
/// Requires macOS 15 (Sequoia) or later.

import Foundation
import Translation

// MARK: - Language Mapping

/// Map ISO 639-1 codes to Locale.Language used by Translation framework
let languageMap: [String: Locale.Language] = [
    "ja": Locale.Language(identifier: "ja"),
    "en": Locale.Language(identifier: "en"),
    "zh": Locale.Language(identifier: "zh-Hans"),
    "ko": Locale.Language(identifier: "ko"),
    "fr": Locale.Language(identifier: "fr"),
    "de": Locale.Language(identifier: "de"),
    "es": Locale.Language(identifier: "es"),
    "pt": Locale.Language(identifier: "pt"),
    "ru": Locale.Language(identifier: "ru"),
    "it": Locale.Language(identifier: "it"),
    "nl": Locale.Language(identifier: "nl"),
    "pl": Locale.Language(identifier: "pl"),
    "ar": Locale.Language(identifier: "ar"),
    "th": Locale.Language(identifier: "th"),
    "vi": Locale.Language(identifier: "vi"),
    "id": Locale.Language(identifier: "id"),
    "uk": Locale.Language(identifier: "uk"),
    "tr": Locale.Language(identifier: "tr")
]

// MARK: - CLI Argument Parsing

enum Command {
    case daemon
    case translate(text: String, from: String, to: String, json: Bool)
    case languages
    case help
}

func parseArguments() -> Command {
    let args = Array(CommandLine.arguments.dropFirst())

    guard let subcommand = args.first else {
        return .help
    }

    switch subcommand {
    case "daemon":
        return .daemon

    case "translate":
        guard args.count >= 2 else {
            fputs("Error: missing text argument\n", stderr)
            return .help
        }
        let text = args[1]
        var from = "ja"
        var to = "en"
        var json = false

        var i = 2
        while i < args.count {
            switch args[i] {
            case "--from":
                if i + 1 < args.count { from = args[i + 1]; i += 2 } else { i += 1 }
            case "--to":
                if i + 1 < args.count { to = args[i + 1]; i += 2 } else { i += 1 }
            case "--json":
                json = true; i += 1
            default:
                i += 1
            }
        }

        return .translate(text: text, from: from, to: to, json: json)

    case "languages":
        return .languages

    default:
        return .help
    }
}

// MARK: - Translation

@available(macOS 15.0, *)
func translateText(_ text: String, from fromCode: String, to toCode: String) async throws -> String {
    guard let fromLang = languageMap[fromCode] else {
        throw TranslateError.unsupportedLanguage(fromCode)
    }
    guard let toLang = languageMap[toCode] else {
        throw TranslateError.unsupportedLanguage(toCode)
    }

    let config = TranslationSession.Configuration(
        source: fromLang,
        target: toLang
    )
    let session = TranslationSession(configuration: config)
    let response = try await session.translate(text)
    return response.targetText
}

@available(macOS 15.0, *)
func getSupportedLanguages() async -> [String] {
    let supported = await LanguageAvailability().supportedLanguages
    var codes: [String] = []
    for lang in supported {
        let id = lang.minimalIdentifier
        // Only return codes we have in our map
        if languageMap.values.contains(where: { $0.minimalIdentifier == id }) {
            // Find the ISO 639-1 key
            for (key, val) in languageMap {
                if val.minimalIdentifier == id {
                    codes.append(key)
                    break
                }
            }
        }
    }
    return codes.sorted()
}

enum TranslateError: LocalizedError {
    case unsupportedLanguage(String)
    case invalidRequest(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedLanguage(let code):
            return "Unsupported language: \(code)"
        case .invalidRequest(let msg):
            return "Invalid request: \(msg)"
        }
    }
}

// MARK: - Daemon Mode

@available(macOS 15.0, *)
func runDaemon() async {
    // Signal readiness
    let ready: [String: Any] = ["status": "ready"]
    if let data = try? JSONSerialization.data(withJSONObject: ready),
       let json = String(data: data, encoding: .utf8) {
        print(json)
        fflush(stdout)
    }

    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            let err: [String: Any] = ["error": "Invalid JSON"]
            writeJSON(err)
            continue
        }

        let reqId = request["_reqId"] as? Int
        let action = request["action"] as? String ?? ""

        switch action {
        case "translate":
            guard let text = request["text"] as? String,
                  let from = request["from"] as? String,
                  let to = request["to"] as? String else {
                writeJSON(errorResponse("Missing text, from, or to fields", reqId: reqId))
                continue
            }

            do {
                let translated = try await translateText(text, from: from, to: to)
                var resp: [String: Any] = ["translated": translated, "from": from, "to": to]
                if let id = reqId { resp["_reqId"] = id }
                writeJSON(resp)
            } catch {
                writeJSON(errorResponse(error.localizedDescription, reqId: reqId))
            }

        case "languages":
            let langs = await getSupportedLanguages()
            var resp: [String: Any] = ["languages": langs]
            if let id = reqId { resp["_reqId"] = id }
            writeJSON(resp)

        case "dispose":
            return

        default:
            writeJSON(errorResponse("Unknown action: \(action)", reqId: reqId))
        }
    }
}

func errorResponse(_ message: String, reqId: Int?) -> [String: Any] {
    var resp: [String: Any] = ["error": message]
    if let id = reqId { resp["_reqId"] = id }
    return resp
}

func writeJSON(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let json = String(data: data, encoding: .utf8) {
        print(json)
        fflush(stdout)
    }
}

// MARK: - One-shot Commands

@available(macOS 15.0, *)
func runTranslate(text: String, from: String, to: String, json: Bool) async {
    do {
        let translated = try await translateText(text, from: from, to: to)
        if json {
            let output: [String: Any] = [
                "translated": translated,
                "from": from,
                "to": to
            ]
            if let data = try? JSONSerialization.data(withJSONObject: output),
               let str = String(data: data, encoding: .utf8) {
                print(str)
            }
        } else {
            print(translated)
        }
    } catch {
        fputs("Error: \(error.localizedDescription)\n", stderr)
        Darwin.exit(EXIT_FAILURE)
    }
}

@available(macOS 15.0, *)
func runListLanguages() async {
    let langs = await getSupportedLanguages()
    for lang in langs {
        print(lang)
    }
}

// MARK: - Help

func printHelp() {
    let help = """
    apple-translate: CLI bridge for Apple Translation framework (macOS 15+)

    Usage:
      apple-translate daemon
      apple-translate translate <text> --from <lang> --to <lang> [--json]
      apple-translate languages
      apple-translate help

    Commands:
      daemon      Run as JSON-over-stdio daemon (for Electron IPC)
      translate   Translate text (one-shot)
      languages   List supported language codes
      help        Show this help message

    Options:
      --from <lang>  Source language ISO 639-1 code (default: ja)
      --to <lang>    Target language ISO 639-1 code (default: en)
      --json         Output JSON instead of plain text

    Requirements:
      macOS 15 (Sequoia) or later
    """
    print(help)
}

// MARK: - Entry Point

if #available(macOS 15.0, *) {
    let command = parseArguments()

    switch command {
    case .daemon:
        await runDaemon()

    case .translate(let text, let from, let to, let json):
        await runTranslate(text: text, from: from, to: to, json: json)

    case .languages:
        await runListLanguages()

    case .help:
        printHelp()
    }
} else {
    fputs("Error: apple-translate requires macOS 15 (Sequoia) or later\n", stderr)
    Darwin.exit(EXIT_FAILURE)
}
