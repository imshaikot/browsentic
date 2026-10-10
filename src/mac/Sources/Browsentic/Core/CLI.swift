import Foundation

enum CLIError: LocalizedError {
    case failed(String)
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .failed(let detail): detail.isEmpty ? "The browsentic command exited with an error — see Settings → Logs." : detail
        case .unreadable(let command): "“browsentic \(command)” printed something this app cannot read — update the app."
        }
    }
}

/// Everything the control socket does not carry goes through the installed command, so the app
/// and a terminal can never disagree about what an operation does.
struct CLI {
    let node: NodeInstall

    @discardableResult
    func run(_ arguments: [String], timeout: TimeInterval = 90) async throws -> String {
        let result = await Shell.run(node.path, [Paths.cliEntry.path] + arguments, extraPath: [node.binDir], timeout: timeout)
        guard result.ok else { throw CLIError.failed(result.failure) }
        return result.stdout
    }

    func json<Value: Decodable>(_ arguments: [String], as _: Value.Type, timeout: TimeInterval = 90) async throws -> Value {
        let output = try await run(arguments + ["--json"], timeout: timeout)
        guard let start = output.firstIndex(where: { $0 == "{" || $0 == "[" }),
              let value = try? JSONDecoder().decode(Value.self, from: Data(output[start...].utf8))
        else { throw CLIError.unreadable(arguments.joined(separator: " ")) }
        return value
    }

    func start() async throws { try await run(["start"]) }
    func stop() async throws { try await run(["stop"]) }
    func restart() async throws { try await run(["restart"]) }

    /// Registers the Bridge with every browser, store copies included, and starts it. Asks nothing.
    func registerBridge() async throws -> SetupResult {
        try await json(["setup", "--no-pair", "--no-open", "--no-wait", "--no-self-update"], as: SetupResult.self)
    }

    func installExtension(force: Bool = false) async throws -> SetupResult {
        try await json(["setup", "--unpacked", "--no-pair", "--no-open", "--no-wait", "--no-self-update"] + (force ? ["--force"] : []), as: SetupResult.self)
    }

    /// Opens that browser's store page in it, when the command can find it, and mints the code to enter.
    func addExtension(to browser: String) async throws -> SetupResult {
        try await json(["setup", "--browser", browser, "--no-wait", "--no-self-update"], as: SetupResult.self, timeout: 120)
    }

    func browsers() async throws -> [BrowserRow] { try await json(["browsers"], as: BrowserListing.self).browsers }

    func agents() async throws -> AgentState { try await json(["agent"], as: AgentState.self) }
    func android() async throws -> AndroidState { try await json(["android"], as: AndroidState.self, timeout: 30) }
    func setModel(_ model: String?, for kind: String) async throws { try await run(["agent", "model", kind] + (model.map { [$0] } ?? [])) }
    func skills() async throws -> SkillListing { try await json(["skills"], as: SkillListing.self) }
    func approvals() async throws -> [Grant] { try await json(["approvals"], as: GrantListing.self).grants }
    func clearApprovals(host: String?) async throws { try await run(["approvals", "clear"] + (host.map { [$0] } ?? [])) }
    func downloads() async throws -> DownloadListing { try await json(["downloads"], as: DownloadListing.self) }
    func clearDownloads() async throws { try await run(["downloads", "clear"]) }
    func uninstall(keepSkills: Bool) async throws -> String {
        try await run(["uninstall", "--yes"] + (keepSkills ? ["--keep-skills"] : []), timeout: 60)
    }
}
