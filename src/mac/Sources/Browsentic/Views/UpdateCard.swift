import SwiftUI

struct UpdateCard: View {
    @EnvironmentObject private var model: AppModel

    static let installLine = "curl -fsSL https://browsentic.com/install.sh | sh"

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    Image(systemName: icon).font(.system(size: 22)).foregroundStyle(tint)
                    SectionTitle(title: title, subtitle: subtitle)
                    Spacer(minLength: 12)
                    actions
                }
                if case .downloading(let fraction) = model.updatePhase {
                    ProgressView(value: fraction).tint(Palette.brand)
                }
            }
        }
        .overlay {
            if model.update != nil {
                RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.brand.opacity(0.45))
            }
        }
        .animation(.spring(duration: 0.4), value: model.updatePhase)
    }

    @ViewBuilder private var actions: some View {
        switch model.updatePhase {
        case .downloading, .verifying, .relaunching:
            ProgressView().controlSize(.small)
        case .failed:
            CopyButton(value: Self.installLine, label: "Copy the terminal line")
            Button { Task { await model.installUpdate() } } label: { Label("Try again", systemImage: "arrow.clockwise") }
                .buttonStyle(PrimaryButtonStyle())
        case .idle, .checking:
            if let update = model.update {
                Button("What's new") { NSWorkspace.shared.open(update.notes) }.buttonStyle(QuietButtonStyle())
                if update.hasMacBuild {
                    Button { Task { await model.installUpdate() } } label: { Label("Update now", systemImage: "arrow.down.circle") }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    checkButton("Check again")
                }
            } else {
                checkButton("Check for updates")
            }
        }
    }

    private func checkButton(_ label: String) -> some View {
        Button { Task { await model.checkForUpdate(announce: true) } } label: {
            Label(model.updatePhase == .checking ? "Checking…" : label, systemImage: "arrow.triangle.2.circlepath")
        }
        .buttonStyle(QuietButtonStyle())
        .disabled(model.updatePhase == .checking)
    }

    private var icon: String {
        if case .failed = model.updatePhase { return "exclamationmark.triangle.fill" }
        return model.update == nil ? "checkmark.seal.fill" : "arrow.down.circle.fill"
    }

    private var tint: Color {
        if case .failed = model.updatePhase { return Palette.amber }
        return model.update == nil ? Palette.lime : Palette.brand
    }

    private var title: String {
        switch model.updatePhase {
        case .downloading(let fraction): return "Downloading Browsentic \(model.update?.version ?? "") · \(Int(fraction * 100))%"
        case .verifying: return "Checking the download"
        case .relaunching: return "Reopening on the new version"
        case .failed: return "The update did not install"
        case .idle, .checking:
            guard let update = model.update else { return "Browsentic \(model.appVersion) is up to date" }
            return "Browsentic \(update.version) is out"
        }
    }

    private var subtitle: String {
        switch model.updatePhase {
        case .downloading, .verifying: return "The daemon keeps running while this happens."
        case .relaunching: return "The app closes for a moment, then replaces the command, the daemon and the extension."
        case .failed(let reason): return "\(reason) Nothing was changed. The terminal line installs the same release."
        case .idle, .checking:
            guard let update = model.update else {
                return model.lastUpdateCheck.map { "Checked GitHub and npm \(Timestamp.ago($0))." } ?? "Checks GitHub and npm when it opens and every few hours after."
            }
            return update.hasMacBuild
                ? "You have \(model.appVersion). One press replaces the app, then the command, the daemon and the extension, and reopens it."
                : "You have \(model.appVersion). The release is published, but its Mac build is still being attached — usually a few minutes."
        }
    }
}
