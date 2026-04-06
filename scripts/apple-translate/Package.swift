// swift-tools-version: 6.0
// Requires Xcode 16+ (macOS 15 Sequoia SDK)

import PackageDescription

let package = Package(
    name: "apple-translate",
    platforms: [
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "apple-translate",
            path: "Sources"
        )
    ]
)
