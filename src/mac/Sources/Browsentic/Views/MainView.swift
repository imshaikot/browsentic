import SwiftUI

struct MainView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                switch model.tab {
                case .overview: Page { OverviewView() }
                case .browsers: Page { BrowsersView() }
                case .android: Page { AndroidView() }
                case .settings: SettingsScreen()
                case .about: Page { AboutView() }
                }
            }
            .id(model.tab)
            .transition(.opacity.combined(with: .offset(y: 8)))

            TabCapsule().padding(.top, 6)
        }
        .animation(.easeInOut(duration: 0.22), value: model.tab)
    }
}

private struct Page<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: 880)
                .padding(.horizontal, 28)
                .padding(.top, 64)
                .padding(.bottom, 36)
                .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
    }
}

/// The view switcher floats at the top centre, ⌘1…⌘5.
private struct TabCapsule: View {
    @EnvironmentObject private var model: AppModel
    @Namespace private var highlight

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases) { tab in
                let selected = model.tab == tab
                Button { model.tab = tab } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.icon).font(.system(size: 11, weight: .semibold))
                        Text(tab.label).font(.system(size: 12, weight: .medium))
                        if let badge = tab.badge {
                            TabBadge(text: badge, selected: selected)
                        }
                        if tab == .overview, model.update != nil {
                            Circle().fill(selected ? Palette.onBrand : Palette.brand).frame(width: 6, height: 6)
                        }
                    }
                    .foregroundStyle(selected ? Palette.onBrand : Palette.inkDim)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background {
                        if selected { Capsule().fill(Palette.brand).matchedGeometryEffect(id: "tab", in: highlight) }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.line))
        .shadow(color: .black.opacity(0.25), radius: 18, y: 6)
        .animation(.spring(duration: 0.35), value: model.tab)
    }
}

private struct TabBadge: View {
    let text: String
    let selected: Bool

    var body: some View {
        let tint = selected ? Palette.onBrand : Palette.amber
        Text(text.uppercased())
            .font(.system(size: 8.5, weight: .semibold, design: .monospaced))
            .tracking(0.5)
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(tint.opacity(0.5)))
    }
}

struct NoticeBanner: View {
    let notice: Notice

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: notice.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(notice.isError ? Palette.danger : Palette.lime)
            Text(notice.text)
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: 620)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder((notice.isError ? Palette.danger : Palette.lime).opacity(0.4)))
        .shadow(color: .black.opacity(0.3), radius: 20, y: 8)
    }
}

struct OfflineHint: View {
    @EnvironmentObject private var model: AppModel
    let what: String

    var body: some View {
        Card {
            HStack(spacing: 14) {
                Image(systemName: "power").font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.amber)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Browsentic Bridge is off").font(.display(14)).foregroundStyle(Palette.ink)
                    Text("\(what) come from Browsentic Bridge while it runs.").font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                }
                Spacer()
                Button("Turn it on") { Task { await model.setDaemon(on: true) } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.daemon != .off)
            }
        }
    }
}
