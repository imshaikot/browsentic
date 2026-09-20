import Foundation

struct ShellResult {
    let status: Int32
    let stdout: String
    let stderr: String

    var ok: Bool { status == 0 }
    var failure: String {
        let text = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? stdout.trimmingCharacters(in: .whitespacesAndNewlines) : text
    }
}

enum Shell {
    static let fallbackPath = [
        "\(NSHomeDirectory())/.local/bin", "/opt/homebrew/bin", "/usr/local/bin",
        "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    ]

    /// A GUI app inherits launchd's PATH, which has neither Homebrew nor ~/.local/bin on it.
    /// The daemon spawns the agent CLI by name, so it has to be started with the PATH the
    /// user's own terminal would have given it.
    static let loginPath: [String] = {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let marker = "__BROWSENTIC_PATH__"
        let result = runSync(shell, ["-ilc", "printf '\(marker)%s\(marker)' \"$PATH\""], timeout: 6)
        let parts = result.stdout.components(separatedBy: marker)
        let found = parts.count >= 3 ? parts[1].split(separator: ":").map(String.init) : []
        var seen = Set<String>()
        return (found + fallbackPath).filter { !$0.isEmpty && seen.insert($0).inserted }
    }()

    static func environment(extraPath: [String] = []) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = (extraPath + loginPath).joined(separator: ":")
        env.removeValue(forKey: "BROWSENTIC_AGENT_RUN")
        return env
    }

    static func which(_ name: String) -> String? {
        loginPath.map { "\($0)/\(name)" }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    static func run(
        _ executable: String, _ arguments: [String], extraPath: [String] = [], timeout: TimeInterval = 120,
        onLine: (@Sendable (String) -> Void)? = nil
    ) async -> ShellResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: runSync(
                    executable, arguments, environment: environment(extraPath: extraPath), timeout: timeout, onLine: onLine
                ))
            }
        }
    }

    static func runSync(
        _ executable: String, _ arguments: [String], environment: [String: String]? = nil, timeout: TimeInterval,
        onLine: (@Sendable (String) -> Void)? = nil
    ) -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let environment { process.environment = environment }
        process.standardInput = FileHandle.nullDevice

        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err

        let collected = Collected()
        out.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            collected.append(data, to: \.out)
            if let onLine, let text = String(data: data, encoding: .utf8) {
                text.split(whereSeparator: \.isNewline).forEach { onLine(String($0)) }
            }
        }
        err.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            collected.append(data, to: \.err)
            if let onLine, let text = String(data: data, encoding: .utf8) {
                text.split(whereSeparator: \.isNewline).forEach { onLine(String($0)) }
            }
        }

        do { try process.run() } catch {
            return ShellResult(status: 127, stdout: "", stderr: error.localizedDescription)
        }

        let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        process.waitUntilExit()
        killer.cancel()

        out.fileHandleForReading.readabilityHandler = nil
        err.fileHandleForReading.readabilityHandler = nil
        collected.append(out.fileHandleForReading.readDataToEndOfFile(), to: \.out)
        collected.append(err.fileHandleForReading.readDataToEndOfFile(), to: \.err)

        return ShellResult(status: process.terminationStatus, stdout: collected.text(\.out), stderr: collected.text(\.err))
    }

    private final class Collected: @unchecked Sendable {
        var out = Data(), err = Data()
        private let lock = NSLock()

        func append(_ data: Data, to key: ReferenceWritableKeyPath<Collected, Data>) {
            lock.lock(); defer { lock.unlock() }
            self[keyPath: key].append(data)
        }

        func text(_ key: KeyPath<Collected, Data>) -> String {
            lock.lock(); defer { lock.unlock() }
            return String(data: self[keyPath: key], encoding: .utf8) ?? ""
        }
    }
}
