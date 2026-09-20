import SwiftUI

struct Card<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
    }
}

struct SectionTitle: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.display(15)).foregroundStyle(Palette.ink)
            if let subtitle {
                Text(subtitle).font(.system(size: 12)).foregroundStyle(Palette.inkDim).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct Pill: View {
    let text: String
    var tint: Color = Palette.inkDim
    var icon: String?

    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text).font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(tint.opacity(0.13), in: Capsule())
    }
}

struct GlowDot: View {
    let color: Color
    var pulsing = false
    @Environment(\.colorScheme) private var scheme
    @State private var breathe = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .shadow(color: color.opacity(0.9 * Palette.glow(scheme)), radius: breathe ? 7 : 3)
            .onAppear {
                guard pulsing else { return }
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { breathe = true }
            }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var tint: Color = Palette.brand
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Palette.onBrand)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(tint.opacity(enabled ? 1 : 0.4), in: Capsule())
            .shadow(color: tint.opacity(0.45 * Palette.glow(scheme)), radius: configuration.isPressed ? 4 : 12, y: 2)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

struct QuietButtonStyle: ButtonStyle {
    var tint: Color = Palette.ink
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(tint.opacity(enabled ? 1 : 0.4))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Palette.surface2.opacity(configuration.isPressed ? 1 : 0.7), in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.line))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

struct CopyButton: View {
    let value: String
    var label = "Copy"
    @State private var copied = false

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
            copied = true
            Task {
                try? await Task.sleep(nanoseconds: 1_400_000_000)
                copied = false
            }
        } label: {
            Label(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(QuietButtonStyle(tint: copied ? Palette.lime : Palette.ink))
    }
}

struct PathRow: View {
    let url: URL

    var body: some View {
        HStack(spacing: 8) {
            Text(Paths.tilde(url))
                .font(.code(12))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 8)
            CopyButton(value: url.path)
            Button {
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } label: { Label("Reveal", systemImage: "folder") }
                .buttonStyle(QuietButtonStyle())
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.line))
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30, weight: .light)).foregroundStyle(Palette.inkFaint)
            Text(title).font(.display(15)).foregroundStyle(Palette.ink)
            Text(detail)
                .font(.system(size: 12))
                .foregroundStyle(Palette.inkDim)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
    }
}

/// The ground every screen sits on: the ember black, a dot grid, and two slow washes of colour.
struct Backdrop: View {
    @Environment(\.colorScheme) private var scheme
    @State private var drift = false

    var body: some View {
        ZStack {
            Palette.ground
            Canvas { context, size in
                let step: CGFloat = 22
                var dots = Path()
                for x in stride(from: step / 2, to: size.width, by: step) {
                    for y in stride(from: step / 2, to: size.height, by: step) {
                        dots.addEllipse(in: CGRect(x: x, y: y, width: 1.2, height: 1.2))
                    }
                }
                context.fill(dots, with: .color(Palette.ink.opacity(0.07)))
            }
            .mask(RadialGradient(colors: [.black, .clear], center: .top, startRadius: 40, endRadius: 760))

            wash(Palette.brand, strength: scheme == .dark ? 0.20 : 0.12)
                .frame(width: 900, height: 900)
                .offset(x: drift ? -260 : -340, y: drift ? -300 : -240)
            wash(Palette.ember, strength: scheme == .dark ? 0.16 : 0.09)
                .frame(width: 860, height: 860)
                .offset(x: drift ? 380 : 300, y: drift ? 260 : 330)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 11).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

private func wash(_ color: Color, strength: Double) -> some View {
    Circle().fill(RadialGradient(colors: [color.opacity(strength), color.opacity(0)], center: .center, startRadius: 0, endRadius: 440))
}

/// The mark from the extension icon: a browser frame holding three linked nodes.
struct BrandMark: View {
    var lineWidth: CGFloat = 1.75

    var body: some View {
        Canvas { context, size in
            let unit = min(size.width, size.height) / 32
            let at: (CGFloat, CGFloat) -> CGPoint = { CGPoint(x: $0 * unit, y: $1 * unit) }
            let brand = GraphicsContext.Shading.color(Palette.brand)

            let frame = Path(roundedRect: CGRect(x: 2.25 * unit, y: 4.25 * unit, width: 27.5 * unit, height: 23.5 * unit), cornerRadius: 6 * unit)
            context.stroke(frame, with: .color(Palette.brand.opacity(0.55)), lineWidth: 1.5 * unit)

            var bar = Path()
            bar.move(to: at(2.5, 10.5))
            bar.addLine(to: at(29.5, 10.5))
            context.stroke(bar, with: .color(Palette.brand.opacity(0.35)), lineWidth: 1.25 * unit)
            for (x, alpha) in [(6.4, 0.5), (9.8, 0.35)] {
                context.fill(Path(ellipseIn: CGRect(x: (x - 1) * unit, y: 6.4 * unit, width: 2 * unit, height: 2 * unit)), with: .color(Palette.brand.opacity(alpha)))
            }

            var curve = Path()
            curve.move(to: at(9, 22.2))
            curve.addCurve(to: at(15.9, 15.8), control1: at(11.4, 22.2), control2: at(11.4, 15.8))
            curve.addCurve(to: at(22.9, 22.2), control1: at(20.4, 15.8), control2: at(20.5, 22.2))
            context.stroke(curve, with: brand, style: StrokeStyle(lineWidth: lineWidth * unit, lineCap: .round))

            for (x, y, r, filled) in [(9.0, 22.2, 2.35, false), (15.9, 15.8, 2.55, true), (22.9, 22.2, 2.35, false)] {
                let node = Path(ellipseIn: CGRect(x: (x - r) * unit, y: (y - r) * unit, width: 2 * r * unit, height: 2 * r * unit))
                context.fill(node, with: filled ? brand : .color(Palette.ground))
                context.stroke(node, with: brand, lineWidth: 1.6 * unit)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
