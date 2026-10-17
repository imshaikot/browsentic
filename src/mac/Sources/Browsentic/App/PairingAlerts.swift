import AppKit
import UserNotifications

/// Pairing notifications. They are a convenience only: an ad-hoc signed build may never be allowed to
/// post, so the approval sheet, the menu bar dot and the Dock bounce carry the flow without them.
final class PairingAlerts: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PairingAlerts()

    private enum Category {
        static let request = "PAIR_REQUEST"
        static let connected = "PAIR_CONNECTED"
    }

    private enum Action {
        static let allow = "ALLOW"
        static let deny = "DENY"
        static let unpair = "UNPAIR"
    }

    private enum Key {
        static let request = "request"
        static let nonce = "nonce"
        static let session = "session"
    }

    /// Outside an app bundle, as under `swift run` or `swift test`, the notification center traps.
    private var center: UNUserNotificationCenter? {
        Bundle.main.bundleURL.pathExtension == "app" ? .current() : nil
    }

    func install() {
        guard let center else { return }
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Category.request,
                actions: [
                    UNNotificationAction(identifier: Action.allow, title: "Allow", options: .authenticationRequired),
                    UNNotificationAction(identifier: Action.deny, title: "Deny", options: .destructive),
                ],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: Category.connected,
                actions: [UNNotificationAction(identifier: Action.unpair, title: "Unpair", options: .destructive)],
                intentIdentifiers: []
            ),
        ])
    }

    func ask(about request: PairRequest) async {
        let content = UNMutableNotificationContent()
        content.title = "\(request.name) wants to connect to Browsentic Bridge"
        content.subtitle = "\(SourceLabel.of(request.source).capitalizedFirst) · v\(request.extensionVersion)"
        content.body = "Allow it to use your agent and drive this browser?"
        content.categoryIdentifier = Category.request
        content.userInfo = [Key.request: request.id, Key.nonce: request.nonce]
        content.sound = .default
        await post(content, as: request.id)
    }

    func announce(_ session: BrowserSession) async {
        let content = UNMutableNotificationContent()
        content.title = "\(session.displayName) connected to Browsentic Bridge"
        content.body = "It paired by itself. If that wasn’t you, unpair it."
        content.categoryIdentifier = Category.connected
        content.userInfo = [Key.session: session.id]
        await post(content, as: "connected:\(session.pairing)")
    }

    func withdraw(_ requests: Set<String>) {
        guard let center, !requests.isEmpty else { return }
        center.removeDeliveredNotifications(withIdentifiers: Array(requests))
        center.removePendingNotificationRequests(withIdentifiers: Array(requests))
    }

    /// Asks for permission the first time there is something to say, never at launch.
    private func post(_ content: UNNotificationContent, as identifier: String) async {
        guard let center, await mayPost(center) else { return }
        try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    private func mayPost(_ center: UNUserNotificationCenter) async -> Bool {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional: true
        case .notDetermined: (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        default: false
        }
    }

    func userNotificationCenter(_: UNUserNotificationCenter, willPresent _: UNNotification) async -> UNNotificationPresentationOptions {
        await AppModel.shared.mainWindowVisible ? [.list] : [.banner, .list, .sound]
    }

    func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let request = info[Key.request] as? String
        let nonce = info[Key.nonce] as? String
        let session = info[Key.session] as? String
        switch response.actionIdentifier {
        case Action.allow, Action.deny:
            await AppModel.shared.answer(request: request, nonce: nonce, allow: response.actionIdentifier == Action.allow)
        case Action.unpair:
            if let session { await AppModel.shared.unpair(session: session) }
        default:
            await AppModel.shared.showMainWindow(on: request == nil ? .browsers : nil)
        }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
