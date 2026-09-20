import SwiftUI

struct MainView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                Group {
                    switch model.tab {
                    case .overview: OverviewView()
                    case .browsers: BrowsersView()
                    case .agents: AgentsView()
                    case .skills: SkillsView()
                    case .activity: ActivityView()
                    case .logs: LogsView()
                    case .settings: SettingsView()
                    }
                }
                .frame(maxWidth: 880)
                .padding(.horizontal, 28)
                .padding(.top, 64)
                .padding(.bottom, 36)
                .frame(maxWidth: .infinity)
                .id(model.tab)
                .transition(.opacity.combined(with: .offset(y: 8)))
            }
            .scrollIndicators(.never)

            TabCapsule().padding(.top, 6)
        }
        .animation(.easeInOut(duration: 0.22), value: model.tab)
    }
}

/// The view switcher floats at the top centre, ⌘1…⌘7.
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
                    Text("The daemon is off").font(.display(14)).foregroundStyle(Palette.ink)
                    Text("\(what) come from the running daemon.").font(.system(size: 12)).foregroundStyle(Palette.inkDim)
                }
                Spacer()
                Button("Turn it on") { Task { await model.setDaemon(on: true) } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.daemon != .off)
            }
        }
    }
}
