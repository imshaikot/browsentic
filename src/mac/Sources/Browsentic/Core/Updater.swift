import Foundation

struct AppRelease: Equatable {
    let version: String
    let hasMacBuild: Bool

    var dmg: URL { URL(string: "https://github.com/\(UpdateFeed.repo)/releases/download/v\(version)/Browsentic-\(version).dmg")! }
    var notes: URL { URL(string: "https://github.com/\(UpdateFeed.repo)/releases/tag/v\(version)")! }
}

enum UpdatePhase: Equatable {
    case idle
    case checking
    case downloading(Double)
    case verifying
    case relaunching
    case failed(String)

    var isInstalling: Bool {
        switch self {
        case .downloading, .verifying, .relaunching: true
        default: false
        }
    }
}

enum UpdateError: LocalizedError {
    case unreachable
    case notABundle
    case image(String)
    case signature
    case mismatch(found: String, expected: String)
    case copy(String)

    var errorDescription: String? {
        switch self {
        case .unreachable: "Neither GitHub nor npm answered — check the connection and try again."
        case .notABundle: "This copy is not running from Browsentic.app, so there is nothing to replace."
        case .image(let detail): "The download would not open as a disk image. \(detail)"
        case .signature: "The downloaded app's signature does not match its contents, so it was not installed."
        case .mismatch(let found, let expected): "The download holds \(found), not Browsentic \(expected), so it was not installed."
        case .copy(let detail): "The new app could not be copied into place. \(detail)"
        }
    }
}

/// A release reaches npm and GitHub minutes apart, and the disk image is attached to the GitHub
/// release last of all, so the newest version either source names may not have a Mac build yet.
enum UpdateFeed {
    static let repo = "imshaikot/browsentic"
    static let package = "browsentic"

    static func newest(of candidates: [String?], after current: String) -> String? {
        candidates.compactMap { $0 }.reduce(nil) { best, next in
            Version.isNewer(next, than: best ?? current) ? next : best
        }
    }

    static func latest(after current: String) async throws -> AppRelease? {
        async let tag = field("tag_name", at: "https://api.github.com/repos/\(repo)/releases/latest")
        async let published = field("version", at: "https://registry.npmjs.org/\(package)/latest")
        let candidates = await [tag.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "v")) }, published]
        guard candidates.contains(where: { $0 != nil }) else { throw UpdateError.unreachable }
        guard let version = newest(of: candidates, after: current) else { return nil }
        let release = AppRelease(version: version, hasMacBuild: false)
        return AppRelease(version: version, hasMacBuild: await exists(release.dmg))
    }

    private static func field(_ key: String, at address: String) async -> String? {
        var request = URLRequest(url: URL(string: address)!)
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object[key] as? String
    }

    private static func exists(_ url: URL) async -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }
}

enum AppUpdater {
    static let finishKey = "finishUpdateOnLaunch"

    /// A translocated or disk-image copy cannot be replaced where it runs, so the new app goes
    /// where the installer would have put it.
    static func destination(running bundle: URL = Bundle.main.bundleURL) throws -> URL {
        guard bundle.pathExtension == "app" else { throw UpdateError.notABundle }
        let files = FileManager.default
        let parent = bundle.deletingLastPathComponent()
        if !bundle.path.contains("/AppTranslocation/"), files.isWritableFile(atPath: parent.path) { return bundle }
        let shared = URL(fileURLWithPath: "/Applications", isDirectory: true)
        let folder = files.isWritableFile(atPath: shared.path) ? shared : Paths.home.appendingPathComponent("Applications", isDirectory: true)
        return folder.appendingPathComponent("Browsentic.app", isDirectory: true)
    }

    /// Downloads, verifies and copies the new app next to where it will live, so the swap that
    /// follows is a rename on one volume.
    static func stage(_ release: AppRelease, onPhase: @escaping @Sendable (UpdatePhase) -> Void) async throws -> (staged: URL, destination: URL) {
        let files = FileManager.default
        let destination = try destination()

        onPhase(.downloading(0))
        let image = try await Downloader().download(release.dmg) { onPhase(.downloading($0)) }
        defer { try? files.removeItem(at: image) }

        onPhase(.verifying)
        let mount = files.temporaryDirectory.appendingPathComponent("browsentic-update-\(UUID().uuidString)", isDirectory: true)
        try files.createDirectory(at: mount, withIntermediateDirectories: true)
        let attached = await Shell.run("/usr/bin/hdiutil", ["attach", image.path, "-nobrowse", "-readonly", "-quiet", "-mountpoint", mount.path])
        guard attached.ok else { throw UpdateError.image(attached.failure) }
        defer {
            _ = Shell.runSync("/usr/bin/hdiutil", ["detach", mount.path, "-quiet", "-force"], timeout: 30)
            try? files.removeItem(at: mount)
        }

        let source = mount.appendingPathComponent("Browsentic.app", isDirectory: true)
        guard await Shell.run("/usr/bin/codesign", ["--verify", "--deep", source.path]).ok else { throw UpdateError.signature }
        let found = identity(of: source)
        guard found == "\(Bundle.main.bundleIdentifier ?? "") \(release.version)" else {
            throw UpdateError.mismatch(found: found, expected: release.version)
        }

        try files.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        let staged = destination.deletingLastPathComponent().appendingPathComponent(".Browsentic-\(release.version).app", isDirectory: true)
        try? files.removeItem(at: staged)
        let copied = await Shell.run("/usr/bin/ditto", [source.path, staged.path], timeout: 300)
        guard copied.ok else {
            try? files.removeItem(at: staged)
            throw UpdateError.copy(copied.failure)
        }
        _ = await Shell.run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged.path])
        return (staged, destination)
    }

    static func identity(of bundle: URL) -> String {
        let info = NSDictionary(contentsOf: bundle.appendingPathComponent("Contents/Info.plist"))
        return "\(info?["CFBundleIdentifier"] as? String ?? "an unknown app") \(info?["CFBundleShortVersionString"] as? String ?? "?")"
    }

    /// A running app cannot replace its own bundle, so a detached shell waits for this process
    /// to exit, swaps the bundles, puts the old one back if the swap fails, and reopens the app.
    static func relaunch(into staged: URL, at destination: URL) throws {
        let script = """
        tries=0
        while kill -0 "$1" 2>/dev/null && [ "$tries" -lt 150 ]; do sleep 0.2; tries=$((tries + 1)); done
        if kill -0 "$1" 2>/dev/null; then rm -rf "$2"; exit 1; fi
        rm -rf "$3.previous"
        [ -e "$3" ] && mv "$3" "$3.previous"
        if mv "$2" "$3"; then rm -rf "$3.previous"; else mv "$3.previous" "$3"; fi
        open -n "$3"
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "browsentic-update", "\(ProcessInfo.processInfo.processIdentifier)", staged.path, destination.path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }
}
