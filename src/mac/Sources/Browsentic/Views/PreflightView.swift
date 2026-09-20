import SwiftUI

struct PreflightView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            Beacon(active: model.preflightBusy || model.fixing, settled: model.canEnter && !model.preflightBusy)
                .frame(width: 148, height: 148)
            Text("Browsentic")
                .font(.display(30, weight: .bold))
                .foregroundStyle(Palette.ink)
                .padding(.top, 18)
            Text(headline)
                .font(.system(size: 13))
                .foregroundStyle(Palette.inkDim)
                .padding(.top, 4)
                .contentTransition(.opacity)
                .animation(.easeInOut, value: headline)

            VStack(spacing: 8) {
                ForEach(Array(CheckID.allCases.enumerated()), id: \.element) { index, id in
                    CheckRow(id: id, state: model.checks[id] ?? .waiting)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .animation(.spring(duration: 0.5).delay(Double(index) * 0.05), value: model.checks[id])
                }
            }
            .frame(width: 560)
            .padding(.top, 28)

            HStack(spacing: 10) {
                if !model.preflightBusy {
                    if model.needsSetup {
                        Button { Task { await model.setUpEverything() } } label: {
                            Label(model.fixing ? "Setting up…" : "Set up everything", systemImage: "wand.and.stars")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.fixing)
                    } else {
                        Button { model.enter() } label: { Label("Open Browsentic", systemImage: "arrow.right") }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                    Button { Task { await model.runPreflight() } } label: { Label("Check again", systemImage: "arrow.clockwise") }
                        .buttonStyle(QuietButtonStyle())
                        .disabled(model.fixing)
                }
            }
            .frame(height: 40)
            .padding(.top, 22)
            .animation(.easeInOut, value: model.preflightBusy)

            Spacer(minLength: 24)
            Text("Everything Browsentic installs stays in ~/.browsentic and ~/browsentic. No password, no account.")
                .font(.system(size: 11))
                .foregroundStyle(Palette.inkFaint)
                .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var headline: String {
        if model.fixing { return "Installing what is missing" }
        if model.preflightBusy { return "Checking what this Mac already has" }
        if model.needsSetup { return "A few things are missing — one click installs them" }
        return "Everything is in place"
    }
}

/// The loading mark: the brand glyph inside two counter-rotating arcs and a breathing halo.
private struct Beacon: View {
    let active: Bool
    let settled: Bool
    @Environment(\.colorScheme) private var scheme
    @State private var spin = false
    @State private var breathe = false

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Palette.brand.opacity(0.35), .clear], center: .center, startRadius: 4, endRadius: 80))
                .scaleEffect(breathe ? 1.12 : 0.9)
                .opacity(Palette.glow(scheme) * 0.9 + 0.1)
            Circle()
                .trim(from: 0, to: active ? 0.62 : 1)
                .stroke(
                    AngularGradient(colors: [Palette.brand.opacity(0), Palette.brand, Palette.ember], center: .center),
                    style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                )
                .rotationEffect(.degrees(spin ? 360 : 0))
                .padding(6)
            Circle()
                .trim(from: 0, to: active ? 0.3 : 0)
                .stroke(Palette.magenta.opacity(0.8), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .rotationEffect(.degrees(spin ? -360 : 0))
                .padding(16)
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(LinearGradient(colors: [Palette.surface, Palette.ground], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.lineStrong))
                .overlay(BrandMark().padding(12))
                .frame(width: 92, height: 92)
                .shadow(color: (settled ? Palette.lime : Palette.brand).opacity(0.5 * Palette.glow(scheme)), radius: 26)
                .scaleEffect(settled ? 1.04 : 1)
        }
        .animation(.spring(duration: 0.7), value: active)
        .animation(.spring(duration: 0.7), value: settled)
        .onAppear {
            withAnimation(.linear(duration: 2.6).repeatForever(autoreverses: false)) { spin = true }
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { breathe = true }
        }
    }
}

private struct CheckRow: View {
    @EnvironmentObject private var model: AppModel
    let id: CheckID
    let state: CheckState

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: id.icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(state == .waiting ? Palette.inkFaint : Palette.brand)
                .frame(width: 30, height: 30)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(id.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(detailTint)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if case .working(let fraction?, _) = state {
                    ProgressView(value: fraction).tint(Palette.brand).padding(.top, 3)
                }
            }
            Spacer(minLength: 8)
            action
            indicator.frame(width: 22)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(state.needsAttention ? Palette.amber.opacity(0.45) : Palette.line))
        .opacity(state == .waiting ? 0.45 : 1)
    }

    private var detail: String {
        switch state {
        case .waiting: "Waiting"
        case .checking: "Checking…"
        case .passed(let text), .missing(let text), .advisory(let text), .failed(let text): text
        case .working(_, let label): label
        }
    }

    private var detailTint: Color {
        if case .failed = state { return Palette.danger }
        return Palette.inkDim
    }

    @ViewBuilder private var action: some View {
        if !model.fixing, !model.preflightBusy {
            switch (id, state) {
            case (.browser, .advisory):
                Button("Get Chrome") { Task { await model.fix(.browser) } }.buttonStyle(QuietButtonStyle())
            case (.agent, .advisory) where model.node != nil:
                Button("Install Claude Code") { Task { await model.fix(.agent) } }.buttonStyle(QuietButtonStyle())
            case (_, .missing), (_, .failed):
                if id.installsAutomatically {
                    Button("Install") { Task { await model.fix(id) } }.buttonStyle(QuietButtonStyle())
                }
            default: EmptyView()
            }
        }
    }

    @ViewBuilder private var indicator: some View {
        switch state {
        case .waiting: Circle().strokeBorder(Palette.lineStrong, lineWidth: 1.5).frame(width: 16, height: 16)
        case .checking, .working: ProgressView().controlSize(.small)
        case .passed: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.lime).transition(.scale.combined(with: .opacity))
        case .missing: Image(systemName: "arrow.down.circle.fill").foregroundStyle(Palette.amber)
        case .advisory: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.amber)
        case .failed: Image(systemName: "xmark.octagon.fill").foregroundStyle(Palette.danger)
        }
    }
}
