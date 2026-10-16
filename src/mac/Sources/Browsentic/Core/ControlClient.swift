import Foundation

enum ControlError: LocalizedError {
    case offline
    case timeout
    case malformed

    var errorDescription: String? {
        switch self {
        case .offline: "Browsentic Bridge is not running — turn it on from the Overview tab."
        case .timeout: "Browsentic Bridge did not answer in time — restart it from the Overview tab."
        case .malformed: "Browsentic Bridge answered with something this app cannot read — update the app."
        }
    }
}

/// The daemon's `/control` socket, spoken natively: the same frames RemoteBridge sends, with the
/// bearer token from the lockfile. Holding it open is also what keeps the daemon from idling out.
actor ControlClient {
    private var task: URLSessionWebSocketTask?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private let (eventStream, eventSink) = AsyncStream.makeStream(of: String.self)
    private(set) var lock: Lockfile?

    var isOpen: Bool { task?.state == .running }

    /// What the daemon says without being asked, from whichever socket is open at the time.
    nonisolated var events: AsyncStream<String> { eventStream }

    /// True when this opened a new socket, which has subscribed to nothing yet.
    @discardableResult
    func connect(_ lock: Lockfile) -> Bool {
        if self.lock == lock, isOpen { return false }
        close()
        var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(lock.port)/control")!)
        request.setValue("Bearer \(lock.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 5
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        self.lock = lock
        task.resume()
        listen(on: task)
        return true
    }

    func close() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        lock = nil
        failAll(ControlError.offline)
    }

    func status() async throws -> BridgeStatus {
        try await request(["op": "status"], as: Reply<BridgeStatus>.self, key: "status")
    }

    func sessions() async throws -> [BrowserSession] {
        try await request(["op": "sessions"], as: Reply<[BrowserSession]>.self, key: "sessions")
    }

    func pair() async throws -> PairingCode {
        let data = try await send(["op": "pair"])
        return try JSONDecoder().decode(PairingCode.self, from: data)
    }

    func revoke(_ session: BrowserSession?) async throws -> Int {
        try await revoke(session: session?.sessionId, origin: session?.origin)
    }

    func revoke(session: String?, origin: String? = nil) async throws -> Int {
        var frame: [String: Any] = ["op": "revoke"]
        if let origin { frame["origin"] = origin }
        if let session { frame["session"] = session }
        return try await request(frame, as: Reply<Int>.self, key: "revoked")
    }

    /// `watch` makes this socket an approver, sent `pair-requests-changed` whenever the list changes.
    func pairRequests(watch: Bool = true) async throws -> [PairRequest] {
        try await request(["op": "pairRequests", "watch": watch, "as": "app"], as: Reply<[PairRequest]>.self, key: "requests")
    }

    /// `request` is a request id, or an install id, which also lets a kept-out browser back in.
    func decide(_ request: String, allow: Bool, label: String? = nil) async throws {
        var frame: [String: Any] = ["op": "decide", "request": request, "allow": allow]
        if let label { frame["label"] = label }
        try await acknowledged(frame)
    }

    func pairing(set mode: PairingMode? = nil) async throws -> PairingSetting {
        var frame: [String: Any] = ["op": "pairing"]
        if let mode { frame["set"] = mode.rawValue }
        let setting = try await whole(frame, as: PairingSetting.self)
        if let error = setting.error { throw BridgeRefusal(message: error) }
        return setting
    }

    func blocked() async throws -> [BlockedBrowser] {
        try await request(["op": "blocked"], as: Reply<[BlockedBrowser]>.self, key: "blocked")
    }

    /// An empty label goes back to the browser's own name.
    func label(session: String, _ label: String) async throws {
        try await acknowledged(["op": "label", "session": session, "label": label])
    }

    /// Makes this socket the one that shows browser notices; `allowed` says whether this Mac lets the app post them.
    func notices(allowed: Bool) async throws {
        try await acknowledged(["op": "notices", "watch": true, "allowed": allowed])
    }

    /// Hands over every notice waiting to be shown; the Bridge forgets them.
    func takeNotices() async throws -> [QueuedNotice] {
        try await request(["op": "takeNotices"], as: Reply<LossyList<QueuedNotice>>.self, key: "notices").items
    }

    /// The browser the notice came from brings its tab to the front.
    func openNotice(_ notice: String) async throws {
        try await acknowledged(["op": "openNotice", "notice": notice])
    }

    private func acknowledged(_ frame: [String: Any]) async throws {
        let answer = try await whole(frame, as: Acknowledgement.self)
        if !answer.ok { throw BridgeRefusal(message: answer.error ?? "Browsentic Bridge said no.") }
    }

    private func whole<Value: Decodable>(_ frame: [String: Any], as _: Value.Type) async throws -> Value {
        let data = try await send(frame)
        do { return try JSONDecoder().decode(Value.self, from: data) } catch { throw ControlError.malformed }
    }

    func agent(set: String? = nil, grant: String? = nil) async throws -> AgentState {
        var frame: [String: Any] = ["op": "agent"]
        if let set { frame["set"] = set }
        if let grant { frame["grant"] = grant }
        return try await request(frame, as: Reply<AgentState>.self, key: "state", timeout: 60)
    }

    /// The settings the extension's settings page edits too. `watch` subscribes this socket to `settings-changed`.
    func preferences(watch: Bool = false) async throws -> Preferences {
        try await request(["op": "preferences", "watch": watch], as: Reply<Outcome<Preferences>>.self, key: "result").value()
    }

    /// `watch` subscribes this socket to `android-changed`, and `false` lets go so the Bridge stops looking for phones. `launch` opens Chrome on that phone.
    func android(watch: Bool? = nil, launch: String? = nil) async throws -> AndroidState {
        var frame: [String: Any] = ["op": "android"]
        if let watch { frame["watch"] = watch }
        if let launch { frame["launch"] = launch }
        return try await request(frame, as: Reply<Outcome<AndroidState>>.self, key: "result", timeout: launch == nil ? 20 : 40).value()
    }

    func setTheme(_ theme: BrowserTheme) async throws -> Preferences {
        try await setPreference(["kind": "theme", "theme": theme.rawValue])
    }

    /// `value` is an effect, a switch's Bool, or nil to go back to the default Browsentic ships.
    func setGuardrail(_ setting: String, to value: Any?) async throws -> Preferences {
        try await setPreference(["kind": "guardrail", "setting": setting, "value": value ?? NSNull()])
    }

    private func setPreference(_ change: [String: Any]) async throws -> Preferences {
        try await request(["op": "setPreference", "change": change], as: Reply<Outcome<Preferences>>.self, key: "result").value()
    }

    private struct Reply<Value: Decodable>: Decodable {
        let value: Value

        init(from decoder: Decoder) throws {
            let key = decoder.userInfo[Self.keyInfo] as? String ?? ""
            let container = try decoder.container(keyedBy: AnyKey.self)
            value = try container.decode(Value.self, forKey: AnyKey(key))
        }

        static var keyInfo: CodingUserInfoKey { CodingUserInfoKey(rawValue: "replyKey")! }
    }

    private struct AnyKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    private func request<Value: Decodable>(
        _ frame: [String: Any], as _: Reply<Value>.Type, key: String, timeout: TimeInterval = 10
    ) async throws -> Value {
        let data = try await send(frame, timeout: timeout)
        let decoder = JSONDecoder()
        decoder.userInfo[Reply<Value>.keyInfo] = key
        do { return try decoder.decode(Reply<Value>.self, from: data).value } catch { throw ControlError.malformed }
    }

    private func send(_ frame: [String: Any], timeout: TimeInterval = 10) async throws -> Data {
        guard let task, isOpen else { throw ControlError.offline }
        let id = UUID().uuidString
        var framed = frame
        framed["id"] = id
        let text = String(data: try JSONSerialization.data(withJSONObject: framed), encoding: .utf8)!

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            task.send(.string(text)) { [weak self] error in
                guard let error else { return }
                Task { await self?.settle(id, .failure(error)) }
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                await self?.settle(id, .failure(ControlError.timeout))
            }
        }
    }

    private func settle(_ id: String, _ result: Result<Data, Error>) {
        pending.removeValue(forKey: id)?.resume(with: result)
    }

    private func failAll(_ error: Error) {
        let waiting = pending
        pending.removeAll()
        waiting.values.forEach { $0.resume(throwing: error) }
    }

    private func listen(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { await self?.received(result, on: task) }
        }
    }

    private func received(_ result: Result<URLSessionWebSocketTask.Message, Error>, on task: URLSessionWebSocketTask) {
        guard task === self.task else { return }
        switch result {
        case .failure:
            self.task = nil
            lock = nil
            failAll(ControlError.offline)
        case .success(let message):
            if case .string(let text) = message, let data = text.data(using: .utf8),
               let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let id = frame["id"] as? String { settle(id, .success(data)) }
                if let event = frame["event"] as? String { eventSink.yield(event) }
            }
            listen(on: task)
        }
    }
}
