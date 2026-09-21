import CryptoKit
import Foundation

struct NodeInstall: Equatable {
    let path: String
    let version: String
    let isPrivate: Bool

    var binDir: String { (path as NSString).deletingLastPathComponent }
    var npm: String { "\(binDir)/npm" }
}

enum NodeRuntimeError: LocalizedError {
    case noRelease
    case checksum
    case unpack(String)

    var errorDescription: String? {
        switch self {
        case .noRelease: "nodejs.org did not list a release for this Mac — check the connection and try again."
        case .checksum: "The Node.js download did not match its published checksum, so it was discarded — try again."
        case .unpack(let detail): "Node.js downloaded but would not unpack: \(detail)"
        }
    }
}

enum NodeRuntime {
    static let minimumMajor = 20

    /// The user's own Node when it is new enough, otherwise the private copy under ~/.browsentic/runtime.
    static func locate() async -> NodeInstall? {
        let candidates = [(Shell.which("node"), false), (Paths.privateNode.path, true)]
        for (path, isPrivate) in candidates {
            guard let path, FileManager.default.isExecutableFile(atPath: path) else { continue }
            let result = await Shell.run(path, ["--version"], timeout: 8)
            let version = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            if result.ok, Version.major(version) >= minimumMajor {
                return NodeInstall(path: path, version: version, isPrivate: isPrivate)
            }
        }
        return nil
    }

    static var architecture: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        return machine == "arm64" ? "arm64" : "x64"
    }

    private struct Release: Decodable {
        let version: String
        let files: [String]
        let lts: LTS

        enum LTS: Decodable {
            case name(String), none
            init(from decoder: Decoder) throws {
                self = (try? decoder.singleValueContainer().decode(String.self)).map(LTS.name) ?? .none
            }
        }
    }

    /// Downloads the current LTS from nodejs.org into ~/.browsentic/runtime/node. No sudo, no
    /// package manager, and nothing outside ~/.browsentic is touched.
    static func installPrivate(progress: @escaping @Sendable (Double, String) -> Void) async throws -> NodeInstall {
        progress(0, "Finding the current Node.js LTS")
        let (index, _) = try await URLSession.shared.data(from: URL(string: "https://nodejs.org/dist/index.json")!)
        let platform = architecture == "arm64" ? "osx-arm64-tar" : "osx-x64-tar"
        let releases = try JSONDecoder().decode([Release].self, from: index)
        guard let release = releases.first(where: {
            if case .name = $0.lts { return $0.files.contains(platform) }
            return false
        }) else { throw NodeRuntimeError.noRelease }

        let name = "node-\(release.version)-darwin-\(architecture).tar.gz"
        let base = URL(string: "https://nodejs.org/dist/\(release.version)/")!

        let (sums, _) = try await URLSession.shared.data(from: base.appendingPathComponent("SHASUMS256.txt"))
        let expected = String(decoding: sums, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .first { $0.hasSuffix("  \(name)") }?
            .split(separator: " ").first.map(String.init)
        guard let expected else { throw NodeRuntimeError.noRelease }

        progress(0.02, "Downloading Node.js \(release.version)")
        let archive = try await Downloader().download(base.appendingPathComponent(name)) { fraction in
            progress(0.02 + fraction * 0.88, "Downloading Node.js \(release.version)")
        }
        defer { try? FileManager.default.removeItem(at: archive) }

        progress(0.92, "Verifying the download")
        let digest = SHA256.hash(data: try Data(contentsOf: archive, options: .mappedIfSafe))
        guard digest.map({ String(format: "%02x", $0) }).joined() == expected else { throw NodeRuntimeError.checksum }

        progress(0.95, "Unpacking")
        let files = FileManager.default
        let staging = Paths.runtime.appendingPathComponent("node.tmp-\(ProcessInfo.processInfo.processIdentifier)")
        let target = Paths.runtime.appendingPathComponent("node")
        try? files.removeItem(at: staging)
        try files.createDirectory(at: staging, withIntermediateDirectories: true)
        let unpacked = await Shell.run("/usr/bin/tar", ["-xzf", archive.path, "-C", staging.path, "--strip-components", "1"])
        guard unpacked.ok else {
            try? files.removeItem(at: staging)
            throw NodeRuntimeError.unpack(unpacked.failure)
        }
        try? files.removeItem(at: target)
        try files.moveItem(at: staging, to: target)

        progress(1, "Node.js \(release.version) is ready")
        return NodeInstall(path: Paths.privateNode.path, version: release.version, isPrivate: true)
    }
}
