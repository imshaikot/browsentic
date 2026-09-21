import Foundation

final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<URL, Error>?
    private var onProgress: (@Sendable (Double) -> Void)?

    func download(_ url: URL, onProgress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        self.onProgress = onProgress
        let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            session.downloadTask(with: url).resume()
        }
    }

    func urlSession(
        _: URLSession, downloadTask _: URLSessionDownloadTask, didWriteData _: Int64,
        totalBytesWritten written: Int64, totalBytesExpectedToWrite expected: Int64
    ) {
        if expected > 0 { onProgress?(Double(written) / Double(expected)) }
    }

    func urlSession(_: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        guard (200..<300).contains(status) else {
            continuation?.resume(throwing: URLError(.badServerResponse))
            continuation = nil
            return
        }
        let kept = FileManager.default.temporaryDirectory.appendingPathComponent("browsentic-\(UUID().uuidString)-\(downloadTask.originalRequest?.url?.lastPathComponent ?? "download")")
        do {
            try FileManager.default.moveItem(at: location, to: kept)
            continuation?.resume(returning: kept)
        } catch {
            continuation?.resume(throwing: error)
        }
        continuation = nil
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
