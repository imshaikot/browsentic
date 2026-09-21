import SwiftUI

struct BrowsersView: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmingAll = false

    var body: some View {
        VStack(spacing: 18) {
            if model.daemon != .on {
                OfflineHint(what: "Paired browsers")
            } else {
                ConnectCard()
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            SectionTitle(title: "Paired browsers", subtitle: "Each one holds a key of its own. Unpairing drops the key and disconnects it at once.")
                            Spacer()
                            if model.sessions.count > 1 {
                                Button("Unpair all") { confirmingAll = true }.buttonStyle(QuietButtonStyle(tint: Palette.danger))
                            }
                        }
                        if model.sessions.isEmpty {
                            EmptyState(icon: "globe", title: "No browser is paired", detail: "Get a pairing code above and paste it into the Browsentic popup.")
                        } else {
                            ForEach(model.sessions) { SessionRow(session: $0) }
                        }
                    }
                }
            }
        }
        .confirmationDialog("Unpair every browser?", isPresented: $confirmingAll) {
            Button("Unpair all", role: .destructive) { Task { await model.revoke(nil) } }
        } message: { Text("Each one will need a new pairing code to connect again.") }
    }
}

private struct SessionRow: View {
    @EnvironmentObject private var model: AppModel
    let session: BrowserSession

    var body: some View {
        HStack(spacing: 12) {
            GlowDot(color: session.connected ? Palette.lime : Palette.inkFaint, pulsing: session.connected)
            VStack(alignment: .leading, spacing: 3) {
                if let browser = session.browser {
                    Text(browser).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                }
                Text(session.extensionId).font(.code(12)).foregroundStyle(session.browser == nil ? Palette.ink : Palette.inkDim).textSelection(.enabled)
                Text("Extension v\(session.extensionVersion) · paired \(Timestamp.ago(session.pairedAt)) · seen \(Timestamp.ago(session.lastSeenAt))")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Palette.inkDim)
            }
            Spacer()
            Pill(text: session.connected ? "Connected" : "Away", tint: session.connected ? Palette.lime : Palette.inkDim)
            Button("Unpair") { Task { await model.revoke(session) } }
                .buttonStyle(QuietButtonStyle(tint: Palette.danger))
                .disabled(model.busy.contains("revoke"))
        }
        .padding(12)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
