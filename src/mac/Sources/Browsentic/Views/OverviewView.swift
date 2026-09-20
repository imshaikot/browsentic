import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 18) {
            Card(padding: 26) {
                HStack(spacing: 28) {
                    PowerOrb(phase: model.daemon) { Task { await model.setDaemon(on: model.daemon == .off) } }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            GlowDot(color: tint, pulsing: model.daemon == .on)
                            Text(model.daemon.label.uppercased())
                                .font(.system(size: 11, weight: .bold))
                                .kerning(1.2)
                                .foregroundStyle(tint)
                        }
                        Text(title).font(.display(24, weight: .bold)).foregroundStyle(Palette.ink)
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(Palette.inkDim)
                            .fixedSize(horizontal: false, vertical: true)
                        if model.daemon == .on {
                            Button { Task { await model.restartDaemon() } } label: { Label("Restart", systemImage: "arrow.clockwise") }
                                .buttonStyle(QuietButtonStyle())
                                .disabled(model.busy.contains("restart"))
                                .padding(.top, 4)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }

            if let status = model.status, let lock = model.lock {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                    Stat(label: "Address", value: "127.0.0.1:\(status.port)", icon: "network")
                    Stat(label: "Daemon", value: "v\(status.daemonVersion)", detail: "pid \(lock.pid)", icon: "cpu")
                    Stat(
                        label: "Extension", value: status.connected ? "Connected" : "Not connected",
                        detail: status.extensionVersion.map { "v\($0)" }, icon: "puzzlepiece.extension",
                        tint: status.connected ? Palette.lime : Palette.amber
                    )
                    Stat(
                        label: "Tools", value: status.manifestInSync ? "In sync" : "Drifted",
                        detail: status.manifestInSync ? nil : "reload the extension", icon: "wrench.and.screwdriver",
                        tint: status.manifestInSync ? Palette.lime : Palette.amber
                    )
                }
                .transition(.opacity)
            }

            if model.daemon == .on, model.status?.pairedBrowsers == 0 || model.pairing != nil { ConnectCard() }
            ExtensionCard()
        }
        .animation(.spring(duration: 0.45), value: model.daemon)
        .animation(.spring(duration: 0.45), value: model.status)
    }

    private var tint: Color {
        switch model.daemon {
        case .on: Palette.lime
        case .off: Palette.inkFaint
        case .starting, .stopping: Palette.amber
        }
    }

    private var title: String {
        switch model.daemon {
        case .on: model.status?.connected == true ? "Your browser is in the loop" : "Waiting for your browser"
        case .off: "Browsentic is off"
        case .starting: "Bringing the daemon up"
        case .stopping: "Shutting down"
        }
    }

    private var subtitle: String {
        switch model.daemon {
        case .on:
            model.status?.connected == true
                ? "Open the side panel in your browser and say what you want. This window can close — the daemon keeps running."
                : "The daemon is listening. Load the extension and pair it, and the side panel comes alive."
        case .off: "Turn it on and the side panel in your browser can reach the agent you already run."
        case .starting, .stopping: "One moment."
        }
    }
}

private struct PowerOrb: View {
    let phase: DaemonPhase
    let toggle: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var spin = false
    @State private var breathe = false
    @State private var hovering = false

    private var on: Bool { phase == .on }
    private var moving: Bool { phase == .starting || phase == .stopping }

    var body: some View {
        Button(action: toggle) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Palette.brand.opacity(on ? 0.4 : 0), .clear], center: .center, startRadius: 30, endRadius: 78))
                    .scaleEffect(breathe ? 1.1 : 0.94)
                    .opacity(Palette.glow(scheme))
                Circle()
                    .trim(from: 0, to: moving ? 0.35 : 1)
                    .stroke(
                        on || moving
                            ? AnyShapeStyle(AngularGradient(colors: [Palette.brand, Palette.ember, Palette.magenta, Palette.brand], center: .center))
                            : AnyShapeStyle(Palette.lineStrong),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round)
                    )
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .padding(14)
                Circle()
                    .fill(LinearGradient(colors: [Palette.surface2, Palette.ground2], startPoint: .top, endPoint: .bottom))
                    .overlay(Circle().strokeBorder(Palette.lineStrong))
                    .padding(26)
                    .shadow(color: .black.opacity(0.35), radius: 10, y: 6)
                Image(systemName: "power")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(on ? Palette.brand : Palette.inkFaint)
                    .shadow(color: Palette.brand.opacity(on ? 0.8 * Palette.glow(scheme) : 0), radius: 10)
            }
            .frame(width: 148, height: 148)
            .scaleEffect(hovering ? 1.03 : 1)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(moving)
        .onHover { hovering = $0 }
        .animation(.spring(duration: 0.5), value: phase)
        .animation(.spring(duration: 0.3), value: hovering)
        .onAppear {
            withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { spin = true }
            withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) { breathe = true }
        }
        .help(on ? "Turn the daemon off" : "Turn the daemon on")
        .accessibilityLabel(on ? "Turn the daemon off" : "Turn the daemon on")
    }
}

private struct Stat: View {
    let label: String
    let value: String
    var detail: String?
    let icon: String
    var tint: Color = Palette.brand

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(tint)
                Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).kerning(0.8).foregroundStyle(Palette.inkFaint)
            }
            Text(value).font(.display(15)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.8)
            Text(detail ?? " ").font(.code(10.5)).foregroundStyle(Palette.inkDim)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line))
    }
}

struct ConnectCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                SectionTitle(
                    title: "Pair a browser",
                    subtitle: "Open the Browsentic popup in your browser, paste the code, and press Connect. It works once and expires in ten minutes."
                )
                if let pairing = model.pairing {
                    PairingCodeView(pairing: pairing)
                } else {
                    Button { Task { await model.newPairingCode() } } label: { Label("Get a pairing code", systemImage: "key.horizontal") }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.busy.contains("pair"))
                }
            }
        }
    }
}

struct PairingCodeView: View {
    @EnvironmentObject private var model: AppModel
    let pairing: PairingCode

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = max(0, pairing.expiry.timeIntervalSince(context.date))
            HStack(spacing: 18) {
                HStack(spacing: 6) {
                    ForEach(Array(pairing.grouped.enumerated()), id: \.offset) { _, character in
                        if character == "-" {
                            Text("–").font(.code(22)).foregroundStyle(Palette.inkFaint)
                        } else {
                            Text(String(character))
                                .font(.code(24, weight: .bold))
                                .foregroundStyle(Palette.brand)
                                .frame(width: 34, height: 44)
                                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Palette.brand.opacity(0.3)))
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(left > 0 ? "Expires in \(Int(left) / 60):\(String(format: "%02d", Int(left) % 60))" : "Expired")
                        .font(.code(12))
                        .foregroundStyle(left < 60 ? Palette.amber : Palette.inkDim)
                    HStack(spacing: 8) {
                        CopyButton(value: pairing.grouped, label: "Copy code")
                        Button("New code") { Task { await model.newPairingCode() } }.buttonStyle(QuietButtonStyle())
                    }
                }
            }
        }
    }
}

struct ExtensionCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    SectionTitle(title: "The extension", subtitle: subtitle)
                    Spacer()
                    if let stamp = model.stamp { Pill(text: "v\(stamp.version) unpacked", tint: Palette.brand) }
                    if model.extensionNeedsReload { Pill(text: "Reload needed", tint: Palette.amber, icon: "arrow.clockwise") }
                }
                PathRow(url: Paths.extensionDir())
                if model.status?.connected != true {
                    VStack(alignment: .leading, spacing: 8) {
                        Step(number: 1, text: "Open chrome://extensions and turn on Developer mode.")
                        Step(number: 2, text: "Press “Load unpacked”, then ⇧⌘G, and paste the path above.")
                        Step(number: 3, text: "Open the Browsentic popup and paste a pairing code.")
                    }
                }
                HStack(spacing: 8) {
                    ForEach(model.browsers.prefix(3)) { browser in
                        Button { model.openExtensionsPage(in: browser) } label: {
                            Label("Extensions in \(browser.name)", systemImage: "arrow.up.forward.app")
                        }
                        .buttonStyle(QuietButtonStyle())
                    }
                    Spacer()
                    Button { Task { await model.reinstallExtension() } } label: { Label("Write it again", systemImage: "arrow.down.doc") }
                        .buttonStyle(QuietButtonStyle())
                        .disabled(model.busy.contains("extension"))
                }
            }
        }
    }

    private var subtitle: String {
        if model.extensionNeedsReload {
            return "A newer build is unpacked than the one your browser has loaded. Press ↻ on the Browsentic card at chrome://extensions."
        }
        return model.status?.connected == true
            ? "Loaded and talking to the daemon. The folder below has to stay where it is — the browser's pairing is tied to the path."
            : "Browsers only load an unpacked extension by hand, so these three steps are yours."
    }
}

private struct Step: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.code(10, weight: .bold))
                .foregroundStyle(Palette.brand)
                .frame(width: 18, height: 18)
                .background(Palette.brand.opacity(0.14), in: Circle())
            Text(text).font(.system(size: 12.5)).foregroundStyle(Palette.inkDim)
        }
    }
}
