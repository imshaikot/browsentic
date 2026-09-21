import Foundation

enum ControlError: LocalizedError {
    case offline
    case timeout
    case malformed

    var errorDescription: String? {
        switch self {
        case .offline: "The daemon is not running — turn it on from the Overview tab."
        case .timeout: "The daemon did not answer in time — restart it from the Overview tab."
        case .malformed: "The daemon answered with something this app cannot read — update the app."
        }
    }
}

/// The daemon's `/control` socket, spoken natively: the same frames RemoteBridge sends, with the
/// bearer token from the lockfile. Holding it open is also what keeps the daemon from idling out.
actor ControlClient {
    private var task: URLSessionWebSocketTask?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private(set) var lock: Lockfile?

    var isOpen: Bool { task?.state == .running }

    func connect(_ lock: Lockfile) {
        if self.lock == lock, isOpen { return }
        close()
        var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(lock.port)/control")!)
        request.setValue("Bearer \(lock.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 5
        let task = URLSession.shared.webSocketTask(with: request)
        self.task = task
        self.lock = lock
        task.resume()
        listen(on: task)
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
        var frame: [String: Any] = ["op": "revoke"]
        if let session {
            frame["origin"] = session.origin
            if let id = session.sessionId { frame["session"] = id }
        }
        return try await request(frame, as: Reply<Int>.self, key: "revoked")
    }

    func agent(set: String? = nil, grant: String? = nil) async throws -> AgentState {
        var frame: [String: Any] = ["op": "agent"]
        if let set { frame["set"] = set }
        if let grant { frame["grant"] = grant }
        return try await request(frame, as: Reply<AgentState>.self, key: "state", timeout: 60)
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
               let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let id = frame["id"] as? String {
                settle(id, .success(data))
            }
            listen(on: task)
        }
    }
}
