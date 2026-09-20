import Foundation

enum Paths {
    static let home = FileManager.default.homeDirectoryForCurrentUser

    static let state = home.appendingPathComponent(".browsentic", isDirectory: true)
    static let cli = state.appendingPathComponent("cli", isDirectory: true)
    static let cliEntry = cli.appendingPathComponent("dist/cli.js")
    static let cliManifest = cli.appendingPathComponent("package.json")
    static let appMarker = cli.appendingPathComponent(".browsentic-app.json")
    static let bin = state.appendingPathComponent("bin", isDirectory: true)
    static let shim = bin.appendingPathComponent("browsentic")
    static let mcpShim = bin.appendingPathComponent("browsentic-mcp")
    static let runtime = state.appendingPathComponent("runtime", isDirectory: true)
    static let privateNode = runtime.appendingPathComponent("node/bin/node")
    static let lockfile = state.appendingPathComponent("daemon.json")
    static let log = state.appendingPathComponent("daemon.log")
    static let config = state.appendingPathComponent("config.json")

    static let user = home.appendingPathComponent("browsentic", isDirectory: true)
    static let defaultExtension = user.appendingPathComponent("extension/chrome-mv3", isDirectory: true)

    static var payload: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("payload", isDirectory: true)
    }

    static func extensionDir() -> URL {
        guard
            let data = try? Data(contentsOf: config),
            let stored = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let chosen = stored["extensionDir"] as? String, !chosen.isEmpty
        else { return defaultExtension }
        return URL(fileURLWithPath: (chosen as NSString).expandingTildeInPath, isDirectory: true)
    }

    static func tilde(_ url: URL) -> String {
        let path = url.path
        return path.hasPrefix(home.path) ? "~" + path.dropFirst(home.path.count) : path
    }
}
