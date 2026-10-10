import AppKit

/// The brand mark for the menu bar, a template so macOS tints it for the bar. Its centre node is hollow while the Bridge is off.
enum MenuBarMark {
    static let on = draw(running: true)
    static let off = draw(running: false)

    private static func draw(running: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let unit = rect.width / 32
            func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * unit, y: y * unit) }
            func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> CGRect {
                CGRect(x: (x - r) * unit, y: (y - r) * unit, width: 2 * r * unit, height: 2 * r * unit)
            }
            let ink = NSColor.black.cgColor
            context.setLineCap(.round)

            context.setStrokeColor(ink.copy(alpha: 0.7)!)
            context.setLineWidth(2.1 * unit)
            context.addPath(CGPath(roundedRect: CGRect(x: 2.25 * unit, y: 4.25 * unit, width: 27.5 * unit, height: 23.5 * unit), cornerWidth: 6 * unit, cornerHeight: 6 * unit, transform: nil))
            context.strokePath()
            context.setStrokeColor(ink.copy(alpha: 0.5)!)
            context.setLineWidth(1.6 * unit)
            context.move(to: at(3, 10.6))
            context.addLine(to: at(29, 10.6))
            context.strokePath()

            context.setStrokeColor(ink)
            context.setLineWidth(2.4 * unit)
            context.move(to: at(9, 22.2))
            context.addCurve(to: at(15.9, 15.8), control1: at(11.4, 22.2), control2: at(11.4, 15.8))
            context.addCurve(to: at(22.9, 22.2), control1: at(20.4, 15.8), control2: at(20.5, 22.2))
            context.strokePath()

            for (x, y, r, filled) in [(9.0, 22.2, 2.6, false), (15.9, 15.8, 2.7, running), (22.9, 22.2, 2.6, false)] as [(CGFloat, CGFloat, CGFloat, Bool)] {
                context.setBlendMode(.clear)
                context.fillEllipse(in: circle(x, y, r))
                context.setBlendMode(.normal)
                context.setFillColor(ink)
                if filled { context.fillEllipse(in: circle(x, y, r + 0.3)) }
                context.setLineWidth(2 * unit)
                context.strokeEllipse(in: circle(x, y, r))
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
