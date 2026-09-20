// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Browsentic",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Browsentic",
            path: "Sources/Browsentic",
            swiftSettings: [.unsafeFlags(["-parse-as-library"])]
        ),
        .testTarget(
            name: "BrowsenticTests",
            dependencies: ["Browsentic"],
            path: "Tests/BrowsenticTests"
        ),
    ],
    swiftLanguageVersions: [.v5]
)
