import AppKit
import SwiftUI

/// The same words as the Windows app's Android tab (src/windows/ui/views/android.tsx): change both together.
enum AndroidCopy {
    static let title = "Drive Chrome on your Android phone"
    static let subtitle = "Browsentic Bridge reaches Chrome on your phone through adb, Android's debugging tool. Nothing is installed on the phone."
    static let phoneCard = "Your phone"
    static let guideCard = "Set up your phone"
    static let guideSubtitle = "Once per phone. After that, plug it in and open Chrome."
    static let checkAgain = "Check again"
    static let openChrome = "Open Chrome on the phone"
    static let getChrome = "Get Chrome"
    static let copyInstall = "Copy install command"
    static let downloadTools = "Download platform-tools"
    static let offline = "Phone checks"
    static let androidEleven = "Android 11 or later"
    static let platformToolsURL = URL(string: "https://developer.android.com/tools/releases/platform-tools")!
}

struct AndroidView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("androidReadyOnce") private var readyOnce = false
    @State private var guideOpen: Bool?

    var body: some View {
        VStack(spacing: 18) {
            if model.daemon != .on {
                OfflineHint(what: AndroidCopy.offline)
            } else if let android = model.android {
                header
                PhoneCard(android: android)
                if let guide = android.guide, !guide.isEmpty {
                    guideCard(guide, open: guideOpen ?? (android.report?.guided == true || (!readyOnce && !android.isReady)))
                }
            } else {
                ProgressView().padding(60)
            }
        }
        .task(id: model.daemon) { await model.watchAndroid(true) }
        .onDisappear { Task { await model.watchAndroid(false) } }
        .onChange(of: model.android?.isReady, initial: true) { _, ready in if ready == true { readyOnce = true } }
    }

    private var header: some View {
        Card {
            HStack(alignment: .top, spacing: 14) {
                SectionTitle(title: AndroidCopy.title, subtitle: AndroidCopy.subtitle)
                Spacer(minLength: 12)
                if model.busy.contains("android") { ProgressView().controlSize(.small) }
                Button { Task { await model.loadAndroid() } } label: { Label(AndroidCopy.checkAgain, systemImage: "arrow.clockwise") }
                    .buttonStyle(QuietButtonStyle())
                    .disabled(model.busy.contains("android"))
            }
        }
    }

    private func guideCard(_ guide: [AndroidState.GuideStep], open: Bool) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Button { withAnimation(.spring(duration: 0.3)) { guideOpen = !open } } label: {
                    HStack {
                        SectionTitle(title: AndroidCopy.guideCard, subtitle: AndroidCopy.guideSubtitle)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Palette.inkDim)
                            .rotationEffect(.degrees(open ? 0 : -90))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if open {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(guide.enumerated()), id: \.element.id) { index, step in
                            HStack(alignment: .top, spacing: 12) {
                                Text("\(index + 1)")
                                    .font(.system(size: 11.5, weight: .bold))
                                    .foregroundStyle(Palette.brand)
                                    .frame(width: 22, height: 22)
                                    .background(Palette.brand.opacity(0.13), in: Circle())
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 8) {
                                        Text(step.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink)
                                        if step.platform == "android11+" { Pill(text: AndroidCopy.androidEleven) }
                                    }
                                    Text(step.detail)
                                        .font(.system(size: 12))
                                        .foregroundStyle(Palette.inkDim)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                    .transition(.opacity)
                }
            }
        }
    }
}

struct PhoneCard: View {
    @EnvironmentObject private var model: AppModel
    let android: AndroidState

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                SectionTitle(title: AndroidCopy.phoneCard)
                ForEach(android.report?.sections ?? []) { section in
                    if let serial = section.serial {
                        Text(serial).font(.code(11.5, weight: .semibold)).foregroundStyle(Palette.inkDim).padding(.top, 6)
                    }
                    ForEach(section.checks) { check in
                        PhoneCheckRow(check: check, serial: section.serial ?? android.devices?.first?.serial)
                    }
                }
                if let summary = android.report?.summary {
                    Label(summary, systemImage: android.session == nil ? "checkmark.seal" : "dot.radiowaves.left.and.right")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Palette.lime)
                        .padding(.top, 4)
                }
            }
        }
    }
}

private struct PhoneCheckRow: View {
    @EnvironmentObject private var model: AppModel
    let check: AndroidState.Check
    let serial: String?

    private static let icons = [
        "adb": "terminal", "Phone": "candybarphone", "USB debugging": "cable.connector",
        "Chrome": "globe", "Chrome open": "macwindow", "Screen": "sun.max", "Android": "power",
    ]

    private var working: Bool { serial.map { model.busy.contains("android:\($0)") } ?? false }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: Self.icons[check.label] ?? "circle")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Palette.brand)
                .frame(width: 30, height: 30)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text(check.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(check.value)
                    .font(.system(size: 11.5))
                    .foregroundStyle(check.failed ? Palette.ink : Palette.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if let fix = check.fix {
                    Text(fix)
                        .font(.code(11.5))
                        .foregroundStyle(Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                if check.fix != nil || check.action != nil { actions }
            }
            Spacer(minLength: 8)
            if working { ProgressView().controlSize(.small) }
            indicator.frame(width: 22)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(check.failed ? Palette.amber.opacity(0.45) : Palette.line))
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 8) {
            if let serial, check.action == "launchChrome" {
                Button { Task { await model.openChrome(on: serial) } } label: { Label(AndroidCopy.openChrome, systemImage: "play.fill") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(working)
            } else if let serial, check.action == "installChrome" {
                Button { Task { await model.openChrome(on: serial) } } label: { Label(AndroidCopy.getChrome, systemImage: "arrow.down.circle") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(working)
            } else if let fix = check.fix, check.code == "ADB_MISSING" {
                if Shell.which("brew") != nil { CopyButton(value: fix, label: AndroidCopy.copyInstall) }
                Button { NSWorkspace.shared.open(AndroidCopy.platformToolsURL) } label: { Label(AndroidCopy.downloadTools, systemImage: "arrow.down.circle") }
                    .buttonStyle(QuietButtonStyle())
            } else if let fix = check.fix {
                CopyButton(value: fix)
            }
        }
    }

    @ViewBuilder private var indicator: some View {
        switch check.mark {
        case "passed": Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.lime)
        case "advisory": Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.amber)
        default: Image(systemName: "xmark.octagon.fill").foregroundStyle(Palette.danger)
        }
    }
}
