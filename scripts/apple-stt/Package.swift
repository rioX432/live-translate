// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "apple-stt",
    platforms: [
        .macOS(.v26)
    ],
    targets: [
        .executableTarget(
            name: "apple-stt",
            path: "Sources"
        )
    ]
)
