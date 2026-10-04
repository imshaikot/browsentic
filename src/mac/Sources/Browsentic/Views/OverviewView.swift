import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 18) {
            if model.update != nil { UpdateCard().transition(.opacity.combined(with: .offset(y: -8))) }

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
                    Stat(label: "Bridge", value: "v\(status.daemonVersion)", detail: "pid \(lock.pid)", icon: "cpu")
                    Stat(
                        label: "Extension", value: status.connected ? "Connected" : "Not connected",
                        detail: status.extensionVersion.map { "v\($0)" }, icon: "puzzlepiece.extension",
                        tint: status.connected ? Palette.lime : Palette.amber
                    )
                    Stat(
                        label: "Tools", value: status.manifestInSync ? "In sync" : "The extension’s",
                        detail: status.manifestInSync ? nil : "versions differ, which is fine", icon: "wrench.and.screwdriver",
                        tint: status.manifestInSync ? Palette.lime : Palette.brand
                    )
                }
                .transition(.opacity)
            }

            ExtensionCard()
            if model.daemon == .on, model.status?.pairedBrowsers == 0 || model.pairing != nil { ConnectCard() }
            if model.update == nil { UpdateCard() }
        }
        .animation(.spring(duration: 0.45), value: model.daemon)
        .animation(.spring(duration: 0.45), value: model.update)
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
        case .starting: "Starting Browsentic Bridge"
        case .stopping: "Shutting down"
        }
    }

    private var subtitle: String {
        switch model.daemon {
        case .on:
            model.status?.connected == true
                ? "Open the side panel in your browser and say what you want. This window can close — Browsentic Bridge keeps running."
                : "Browsentic Bridge is running. Add the extension to your browser below and pair it once, and the side panel comes alive."
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
        .help(on ? "Turn Browsentic Bridge off" : "Turn Browsentic Bridge on")
        .accessibilityLabel(on ? "Turn Browsentic Bridge off" : "Turn Browsentic Bridge on")
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
                    subtitle: "Click Browsentic in your browser’s toolbar (the puzzle piece lists it), enter the code, and press Connect. It works once and expires in ten minutes."
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
    @State private var showUnpacked: Bool?

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                SectionTitle(title: "The extension", subtitle: subtitle)
                VStack(spacing: 8) {
                    ForEach(model.offeredBrowsers) { BrowserExtensionRow(row: $0) }
                }
                Button { showUnpacked = !unpacked } label: {
                    Label("Load it unpacked instead", systemImage: unpacked ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Palette.inkDim)
                }
                .buttonStyle(.plain)
                if unpacked { UnpackedSteps() }
            }
        }
    }

    /// Open from the start for someone who already loads the unpacked folder.
    private var unpacked: Bool { showUnpacked ?? (model.stamp != nil) }

    private var subtitle: String {
        model.sessions.contains(where: \.connected)
            ? "In your browser and talking to Browsentic Bridge. Store copies update themselves."
            : "Add it from your browser’s store, then click Browsentic in the toolbar and enter the pairing code once."
    }
}

private struct BrowserExtensionRow: View {
    @EnvironmentObject private var model: AppModel
    let row: BrowserRow

    var body: some View {
        HStack(spacing: 12) {
            GlowDot(color: row.copy?.connected == true ? Palette.lime : Palette.inkFaint, pulsing: row.copy?.connected == true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
                Text(detail).font(.system(size: 11.5)).foregroundStyle(Palette.inkDim).lineLimit(1)
            }
            Spacer()
            if stale { Pill(text: "Reload needed", tint: Palette.amber, icon: "arrow.clockwise") }
            if let copy = row.copy {
                Pill(text: copy.connected ? "Connected" : "Not connected", tint: copy.connected ? Palette.lime : Palette.inkDim)
            } else {
                Button { Task { await model.addExtension(row) } } label: { Label(row.addTitle, systemImage: "puzzlepiece.extension") }
                    .buttonStyle(QuietButtonStyle(tint: Palette.brand))
                    .disabled(model.busy.contains("add:\(row.id)"))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var detail: String {
        if let copy = row.copy { return "\(SourceLabel.of(copy.source)) · v\(copy.extensionVersion)" }
        return row.installed ? row.store : "\(row.store) · not found on this Mac"
    }

    private var stale: Bool {
        guard let copy = row.copy, copy.source == "unpacked", let stamp = model.stamp else { return false }
        return copy.extensionVersion != stamp.version
    }
}

private struct UnpackedSteps: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("For a browser that cannot reach a store, such as ungoogled Chromium or a managed profile, or to try a build the stores do not have yet.")
                .font(.system(size: 12))
                .foregroundStyle(Palette.inkDim)
                .fixedSize(horizontal: false, vertical: true)
            PathRow(url: Paths.extensionDir())
            VStack(alignment: .leading, spacing: 8) {
                Step(number: 1, text: "Open chrome://extensions and turn on Developer mode.")
                Step(number: 2, text: "Press “Load unpacked”, then ⇧⌘G, and paste the path above.")
                Step(number: 3, text: "Click Browsentic in the toolbar and enter a pairing code.")
            }
            HStack(spacing: 8) {
                ForEach(model.browsers.filter(\.isChromium).prefix(3)) { browser in
                    Button { model.openExtensionsPage(in: browser) } label: {
                        Label("Extensions in \(browser.name)", systemImage: "arrow.up.forward.app")
                    }
                    .buttonStyle(QuietButtonStyle())
                }
                Spacer()
                Button { Task { await model.reinstallExtension() } } label: {
                    Label(model.stamp == nil ? "Write it" : "Write it again", systemImage: "arrow.down.doc")
                }
                .buttonStyle(QuietButtonStyle())
                .disabled(model.busy.contains("extension"))
            }
        }
        .padding(.leading, 14)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.line).frame(width: 1) }
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
