// Draws the 1024px app icon: the extension's mark on its ember tile, at macOS icon proportions.
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let size: CGFloat = 1024

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let context = NSGraphicsContext.current!.cgContext
context.translateBy(x: 0, y: size)
context.scaleBy(x: 1, y: -1)

let tileRect = CGRect(x: 100, y: 100, width: 824, height: 824)
let tile = CGPath(roundedRect: tileRect, cornerWidth: 186, cornerHeight: 186, transform: nil)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: 12), blur: 28, color: NSColor.black.withAlphaComponent(0.35).cgColor)
context.addPath(tile)
context.setFillColor(rgb(0x110A06).cgColor)
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(tile)
context.clip()
let ground = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [rgb(0x201611).cgColor, rgb(0x0E0805).cgColor] as CFArray, locations: [0, 1])!
context.drawLinearGradient(ground, start: CGPoint(x: 0, y: tileRect.minY), end: CGPoint(x: 0, y: tileRect.maxY), options: [])
let halo = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [rgb(0x3BE1E1, 0.22).cgColor, rgb(0x3BE1E1, 0).cgColor] as CFArray, locations: [0, 1])!
context.drawRadialGradient(halo, startCenter: CGPoint(x: 512, y: 560), startRadius: 0, endCenter: CGPoint(x: 512, y: 560), endRadius: 420, options: [])
let warmth = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [rgb(0xFE804C, 0.16).cgColor, rgb(0xFE804C, 0).cgColor] as CFArray, locations: [0, 1])!
context.drawRadialGradient(warmth, startCenter: CGPoint(x: 860, y: 880), startRadius: 0, endCenter: CGPoint(x: 860, y: 880), endRadius: 380, options: [])
context.restoreGState()

context.addPath(tile)
context.setStrokeColor(rgb(0xFEF7F2, 0.14).cgColor)
context.setLineWidth(3)
context.strokePath()

let unit = tileRect.width / 32
func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: tileRect.minX + x * unit, y: tileRect.minY + y * unit) }
let brand = rgb(0x3BE1E1)

context.setLineCap(.round)
context.addPath(CGPath(roundedRect: CGRect(origin: at(4.25, 6.25), size: CGSize(width: 23.5 * unit, height: 19.5 * unit)), cornerWidth: 5 * unit, cornerHeight: 5 * unit, transform: nil))
context.setStrokeColor(brand.withAlphaComponent(0.55).cgColor)
context.setLineWidth(1.4 * unit)
context.strokePath()

context.move(to: at(4.5, 11.6))
context.addLine(to: at(27.5, 11.6))
context.setStrokeColor(brand.withAlphaComponent(0.35).cgColor)
context.setLineWidth(1.1 * unit)
context.strokePath()
for (x, alpha) in [(7.8, 0.5), (10.8, 0.35)] as [(CGFloat, CGFloat)] {
    let centre = at(x, 8.95)
    context.setFillColor(brand.withAlphaComponent(alpha).cgColor)
    context.fillEllipse(in: CGRect(x: centre.x - 0.9 * unit, y: centre.y - 0.9 * unit, width: 1.8 * unit, height: 1.8 * unit))
}

context.saveGState()
context.setShadow(offset: .zero, blur: 40, color: brand.withAlphaComponent(0.7).cgColor)
context.move(to: at(10, 21.6))
context.addCurve(to: at(16, 15.8), control1: at(12.1, 21.6), control2: at(12.1, 15.8))
context.addCurve(to: at(22, 21.6), control1: at(19.9, 15.8), control2: at(19.9, 21.6))
context.setStrokeColor(brand.cgColor)
context.setLineWidth(1.6 * unit)
context.strokePath()
for (x, y, r, filled) in [(10, 21.6, 2.1, false), (16, 15.8, 2.3, true), (22, 21.6, 2.1, false)] as [(CGFloat, CGFloat, CGFloat, Bool)] {
    let centre = at(x, y)
    let node = CGRect(x: centre.x - r * unit, y: centre.y - r * unit, width: 2 * r * unit, height: 2 * r * unit)
    context.setFillColor((filled ? brand : rgb(0x150D09)).cgColor)
    context.fillEllipse(in: node)
    context.setStrokeColor(brand.cgColor)
    context.setLineWidth(1.45 * unit)
    context.strokeEllipse(in: node)
}
context.restoreGState()

NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
