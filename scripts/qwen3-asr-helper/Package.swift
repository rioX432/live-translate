// swift-tools-version: 6.2
import PackageDescription

// mlx-audio-swift is pinned to a revision because its targets use unsafeFlags,
// which SwiftPM rejects for version-based dependencies.
let package = Package(
    name: "qwen3-asr-helper",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(
            url: "https://github.com/Blaizzy/mlx-audio-swift.git",
            revision: "209e1cb45498c5b7b4b96d417f9b15fe71d440f5"
        ),
    ],
    targets: [
        .executableTarget(
            name: "qwen3-asr-helper",
            dependencies: [
                .product(name: "MLXAudioSTT", package: "mlx-audio-swift"),
            ],
            path: "Sources"
        ),
    ]
)
