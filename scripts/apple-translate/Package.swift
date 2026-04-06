// swift-tools-version: 6.2
// Requires Xcode 26+ (macOS 26 Tahoe SDK)

import PackageDescription

let package = Package(
    name: "apple-translate",
    platforms: [
        .macOS(.v26)
    ],
    targets: [
        .executableTarget(
            name: "apple-translate",
            path: "Sources"
        )
    ]
)
