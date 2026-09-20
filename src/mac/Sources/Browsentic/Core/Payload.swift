import Foundation

enum PayloadError: LocalizedError {
    case missing

    var errorDescription: String? {
        "This copy of Browsentic.app carries no CLI payload — download a fresh one from browsentic.com."
    }
}

/// The CLI, the bundled skills and the extension build, shipped inside the app bundle in the same
/// layout as the npm package and laid down in ~/.browsentic/cli.
enum Payload {
    static func version(at manifest: URL) -> String? {
        guard
            let data = try? Data(contentsOf: manifest),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return parsed["version"] as? String
    }

    static var bundledVersion: String? {
        Paths.payload.flatMap { version(at: $0.appendingPathComponent("package.json")) }
    }

    static var installedVersion: String? {
        FileManager.default.fileExists(atPath: Paths.cliEntry.path) ? version(at: Paths.cliManifest) : nil
    }

    static var isCurrent: Bool {
        guard let bundled = bundledVersion, let installed = installedVersion else { return false }
        return installed == bundled && FileManager.default.fileExists(atPath: Paths.appMarker.path)
    }

    /// A directory swap, which is safe here and not for the extension: Node has already read the
    /// one bundled file a running daemon needs, and nothing derives an identity from this path.
    static func install(node: NodeInstall) throws {
        guard let source = Paths.payload, let version = bundledVersion else { throw PayloadError.missing }
        let files = FileManager.default
        try files.createDirectory(at: Paths.state, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

        let staging = Paths.state.appendingPathComponent("cli.tmp-\(ProcessInfo.processInfo.processIdentifier)")
        try? files.removeItem(at: staging)
        try files.copyItem(at: source, to: staging)

        let marker: [String: Any] = [
            "version": version,
            "app": Bundle.main.bundlePath,
            "installedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        try JSONSerialization.data(withJSONObject: marker, options: [.prettyPrinted, .sortedKeys])
            .write(to: staging.appendingPathComponent(Paths.appMarker.lastPathComponent))

        let retired = Paths.state.appendingPathComponent("cli.old-\(ProcessInfo.processInfo.processIdentifier)")
        if files.fileExists(atPath: Paths.cli.path) { try files.moveItem(at: Paths.cli, to: retired) }
        try files.moveItem(at: staging, to: Paths.cli)
        try? files.removeItem(at: retired)

        try writeShims(node: node)
    }

    static func writeShims(node: NodeInstall) throws {
        let files = FileManager.default
        try files.createDirectory(at: Paths.bin, withIntermediateDirectories: true)
        let resolve = """
        NODE="\(node.path)"
        [ -x "$NODE" ] || NODE="$HOME/.browsentic/runtime/node/bin/node"
        [ -x "$NODE" ] || NODE="$(command -v node)"
        if [ -z "$NODE" ]; then
          echo "browsentic: Node.js \(NodeRuntime.minimumMajor) or newer is missing — open Browsentic.app and it will install it." >&2
          exit 127
        fi
        """
        let shims: [(URL, String)] = [
            (Paths.shim, ""),
            (Paths.mcpShim, "[ $# -eq 0 ] && set -- mcp\n"),
        ]
        for (url, prelude) in shims {
            let script = "#!/bin/sh\n# Written by Browsentic.app — edits are replaced on the next update.\n\(resolve)\n\(prelude)exec \"$NODE\" \"$HOME/.browsentic/cli/dist/cli.js\" \"$@\"\n"
            try script.write(to: url, atomically: true, encoding: .utf8)
            try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        }
    }
}

/// Puts `browsentic` on the terminal's PATH by symlinking the shim into a directory that is
/// already there and already writable, so no shell profile is edited and no password is asked for.
enum CommandLink {
    static let names = ["browsentic", "browsentic-mcp"]

    static var candidates: [String] {
        Shell.loginPath.filter { dir in
            dir.hasPrefix(NSHomeDirectory()) || dir == "/usr/local/bin" || dir == "/opt/homebrew/bin"
        }.filter { !$0.hasPrefix(Paths.state.path) && FileManager.default.isWritableFile(atPath: $0) }
    }

    static var linkedIn: String? {
        Shell.loginPath.first { dir in
            (try? FileManager.default.destinationOfSymbolicLink(atPath: "\(dir)/browsentic")) == Paths.shim.path
        }
    }

    /// A `browsentic` that is on the PATH but is not ours — an npm global, or a source checkout link.
    static var foreign: String? {
        guard linkedIn == nil, let found = Shell.which("browsentic") else { return nil }
        return found
    }

    static func link() throws -> String {
        guard let dir = candidates.first else {
            throw CocoaError(.fileWriteNoPermission, userInfo: [
                NSLocalizedDescriptionKey: "No writable directory on your PATH — add \(Paths.tilde(Paths.bin)) to it in ~/.zprofile instead.",
            ])
        }
        for name in names {
            let link = "\(dir)/\(name)"
            if (try? FileManager.default.destinationOfSymbolicLink(atPath: link)) != nil {
                try FileManager.default.removeItem(atPath: link)
            }
            try FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: Paths.bin.appendingPathComponent(name).path)
        }
        return dir
    }

    static func unlink() {
        guard let dir = linkedIn else { return }
        for name in names { try? FileManager.default.removeItem(atPath: "\(dir)/\(name)") }
    }
}
