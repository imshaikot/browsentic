import AppKit
import UserNotifications

/// The app's notifications: pairing, and the notices a browser hands over while it is out of sight.
/// Pairing ones are a convenience only: an ad-hoc signed build may never be allowed to post, so the
/// approval sheet, the menu bar dot and the Dock bounce carry that flow without them.
final class PairingAlerts: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PairingAlerts()

    private enum Category {
        static let request = "PAIR_REQUEST"
        static let connected = "PAIR_CONNECTED"
        static let notice = "BROWSER_NOTICE"
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
        static let notice = "notice"
        static let browser = "browser"
    }

    @MainActor private var askedForPermission = false

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
                    UNNotificationAction(identifier: Action.allow, title: "Allow"),
                    UNNotificationAction(identifier: Action.deny, title: "Deny", options: .destructive),
                ],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: Category.connected,
                actions: [UNNotificationAction(identifier: Action.unpair, title: "Unpair", options: .destructive)],
                intentIdentifiers: []
            ),
            UNNotificationCategory(identifier: Category.notice, actions: [], intentIdentifiers: []),
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

    func show(_ notice: QueuedNotice) async {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        if let browser = notice.browser { content.subtitle = browser }
        content.body = notice.body
        content.categoryIdentifier = Category.notice
        content.threadIdentifier = Category.notice
        var info = [Key.notice: notice.id]
        info[Key.browser] = notice.browser
        content.userInfo = info
        content.sound = .default
        await post(content, as: NoticeWatch.identifier(for: notice.id))
    }

    /// Whether the app can post right now, asking once if nobody has decided yet. Never true outside an app bundle.
    @MainActor func mayNotify() async -> Bool {
        guard let center else { return false }
        let status = await center.notificationSettings().authorizationStatus
        guard status == .notDetermined, !askedForPermission else { return NoticeWatch.allows(status) }
        askedForPermission = true
        return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
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

    /// A browser notice shows even over this app: whoever reads it is not in the browser.
    func userNotificationCenter(_: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if notification.request.content.categoryIdentifier == Category.notice { return [.banner, .list, .sound] }
        return await AppModel.shared.mainWindowVisible ? [.list] : [.banner, .list, .sound]
    }

    func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let request = info[Key.request] as? String
        let nonce = info[Key.nonce] as? String
        let session = info[Key.session] as? String
        if let notice = info[Key.notice] as? String {
            if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
                await AppModel.shared.openNotice(notice, from: info[Key.browser] as? String)
            }
            return
        }
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
