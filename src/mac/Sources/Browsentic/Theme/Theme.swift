import AppKit
import SwiftUI

/// Ember and Daylight from the extension's globals.css, converted from oklch once. The extension
/// owns the palette; a change there is re-derived here rather than tuned by eye.
enum Palette {
    static let ground = dynamic(dark: 0x110A06, light: 0xFCFBF8)
    static let ground2 = dynamic(dark: 0x19100B, light: 0xF6F4F0)
    static let surface = dynamic(dark: 0x201611, light: 0xF0ECE7)
    static let surface2 = dynamic(dark: 0x2B1F1A, light: 0xE2DDD6)
    static let ink = dynamic(dark: 0xF7F0E9, light: 0x2C231D)
    static let inkDim = dynamic(dark: 0xB2A79E, light: 0x60544C)
    static let inkFaint = dynamic(dark: 0x83766E, light: 0x7D7068)
    static let line = dynamic(dark: 0xFEF7F2, light: 0x362B24, darkAlpha: 0.10, lightAlpha: 0.13)
    static let lineStrong = dynamic(dark: 0xFEF7F2, light: 0x362B24, darkAlpha: 0.18, lightAlpha: 0.24)
    static let brand = dynamic(dark: 0x3BE1E1, light: 0x007791)
    static let brandDeep = dynamic(dark: 0x009BA3, light: 0x005A74)
    static let ember = dynamic(dark: 0xFE804C, light: 0xC04307)
    static let magenta = dynamic(dark: 0xE961D1, light: 0xAC2B98)
    static let lime = dynamic(dark: 0x63EA89, light: 0x187E36)
    static let amber = dynamic(dark: 0xF7C243, light: 0xA66300)
    static let danger = dynamic(dark: 0xF14949, light: 0xC92228)
    static let onBrand = dynamic(dark: 0x06201F, light: 0xFFFFFF)

    /// How strongly glows read. Daylight zeroes them, as it does in the extension: neon only exists on black.
    static func glow(_ scheme: ColorScheme) -> Double { scheme == .dark ? 1 : 0 }

    private static func dynamic(dark: UInt32, light: UInt32, darkAlpha: CGFloat = 1, lightAlpha: CGFloat = 1) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: isDark ? darkAlpha : lightAlpha
            )
        })
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Font {
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
    static func code(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
