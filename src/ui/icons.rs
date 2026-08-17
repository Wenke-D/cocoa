//! Codicon-style line icons, drawn rather than loaded.
//!
//! VS Code's chrome is icon-led, but egui's bundled fonts have no dependable
//! glyphs for the shapes we need, and §41 rules out pulling in an icon font. So
//! each icon here is a handful of strokes laid out on a unit square and mapped
//! into whatever rect the caller allocates. They are deliberately thin — 1.3px
//! at a 16px box, which is what a codicon weighs.

use egui::{Color32, Painter, Pos2, Rect, Shape, Stroke, StrokeKind};

/// The stroke weight every icon is drawn at, relative to a 16px box.
fn stroke(rect: Rect, color: Color32) -> Stroke {
    Stroke::new((rect.width() / 16.0 * 1.3).max(1.0), color)
}

/// Map unit-square coordinates onto the icon's rect.
fn at(rect: Rect, x: f32, y: f32) -> Pos2 {
    egui::pos2(
        rect.left() + x * rect.width(),
        rect.top() + y * rect.height(),
    )
}

fn line(painter: &Painter, rect: Rect, color: Color32, points: &[(f32, f32)]) {
    let points: Vec<Pos2> = points.iter().map(|&(x, y)| at(rect, x, y)).collect();
    painter.add(Shape::line(points, stroke(rect, color)));
}

fn outline(painter: &Painter, rect: Rect, color: Color32, points: &[(f32, f32)]) {
    let points: Vec<Pos2> = points.iter().map(|&(x, y)| at(rect, x, y)).collect();
    painter.add(Shape::convex_polygon(
        points,
        Color32::TRANSPARENT,
        stroke(rect, color),
    ));
}

/// The two overlapping sheets of the Explorer icon.
///
/// `backdrop` is painted behind the front sheet so it occludes the back one,
/// which is how the real codicon reads at small sizes.
pub fn files(painter: &Painter, rect: Rect, color: Color32, backdrop: Color32) {
    let stroke = stroke(rect, color);

    let back = Rect::from_min_max(at(rect, 0.34, 0.08), at(rect, 0.94, 0.68));
    painter.rect_stroke(back, 1.0, stroke, StrokeKind::Middle);

    let front = Rect::from_min_max(at(rect, 0.06, 0.32), at(rect, 0.66, 0.92));
    painter.rect_filled(front, 1.0, backdrop);
    painter.rect_stroke(front, 1.0, stroke, StrokeKind::Middle);
}

/// The Run-and-Debug triangle.
pub fn play(painter: &Painter, rect: Rect, color: Color32) {
    outline(
        painter,
        rect,
        color,
        &[(0.26, 0.10), (0.90, 0.50), (0.26, 0.90)],
    );
}

pub fn gear(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    let center = rect.center();
    let radius = rect.width() * 0.5;

    painter.circle_stroke(center, radius * 0.30, stroke);
    painter.circle_stroke(center, radius * 0.62, stroke);

    // Eight teeth, as short spokes beyond the outer ring.
    for index in 0..8 {
        let angle = std::f32::consts::TAU * index as f32 / 8.0;
        let (sin, cos) = angle.sin_cos();
        let direction = egui::vec2(cos, sin);
        painter.line_segment(
            [
                center + direction * radius * 0.62,
                center + direction * radius * 0.92,
            ],
            stroke,
        );
    }
}

/// A page with lines of text on it: "this run produced a report".
pub fn report(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);

    // Page outline with the top-right corner folded away.
    outline(
        painter,
        rect,
        color,
        &[
            (0.20, 0.08),
            (0.62, 0.08),
            (0.80, 0.28),
            (0.80, 0.92),
            (0.20, 0.92),
        ],
    );
    line(
        painter,
        rect,
        color,
        &[(0.62, 0.08), (0.62, 0.28), (0.80, 0.28)],
    );

    for y in [0.48, 0.63, 0.78] {
        painter.line_segment([at(rect, 0.32, y), at(rect, 0.68, y)], stroke);
    }
}

pub fn chevron_left(painter: &Painter, rect: Rect, color: Color32) {
    line(
        painter,
        rect,
        color,
        &[(0.62, 0.22), (0.32, 0.50), (0.62, 0.78)],
    );
}

pub fn chevron_right(painter: &Painter, rect: Rect, color: Color32) {
    line(
        painter,
        rect,
        color,
        &[(0.38, 0.22), (0.68, 0.50), (0.38, 0.78)],
    );
}

pub fn chevron_down(painter: &Painter, rect: Rect, color: Color32) {
    line(
        painter,
        rect,
        color,
        &[(0.22, 0.38), (0.50, 0.68), (0.78, 0.38)],
    );
}

pub fn arrow_left(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    painter.line_segment([at(rect, 0.14, 0.50), at(rect, 0.88, 0.50)], stroke);
    line(
        painter,
        rect,
        color,
        &[(0.42, 0.22), (0.14, 0.50), (0.42, 0.78)],
    );
}

/// The status bar's refresh spinner shape: an open ring with one arrowhead.
pub fn sync(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    let center = rect.center();
    let radius = rect.width() * 0.34;

    let point_at = |turns: f32| {
        let angle = std::f32::consts::TAU * turns;
        center + egui::vec2(angle.cos(), angle.sin()) * radius
    };

    const START: f32 = 0.80;
    const SWEEP: f32 = 0.72;

    let arc: Vec<Pos2> = (0..=24)
        .map(|step| point_at(START + SWEEP * step as f32 / 24.0))
        .collect();
    painter.add(Shape::line(arc, stroke));

    // Arrowhead on the tangent at the arc's own end, not at a fixed angle.
    let tip = point_at(START);
    let tangent = (point_at(START) - point_at(START + 0.02)).normalized();
    let side = egui::vec2(-tangent.y, tangent.x);
    painter.add(Shape::convex_polygon(
        vec![
            tip + tangent * radius * 0.55,
            tip - tangent * radius * 0.15 + side * radius * 0.42,
            tip - tangent * radius * 0.15 - side * radius * 0.42,
        ],
        color,
        Stroke::NONE,
    ));
}

pub fn warning(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    outline(
        painter,
        rect,
        color,
        &[(0.50, 0.10), (0.95, 0.88), (0.05, 0.88)],
    );
    painter.line_segment([at(rect, 0.50, 0.40), at(rect, 0.50, 0.62)], stroke);
    painter.circle_filled(at(rect, 0.50, 0.75), stroke.width * 0.7, color);
}

pub fn error(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    painter.circle_stroke(rect.center(), rect.width() * 0.42, stroke);
    painter.line_segment([at(rect, 0.34, 0.34), at(rect, 0.66, 0.66)], stroke);
    painter.line_segment([at(rect, 0.66, 0.34), at(rect, 0.34, 0.66)], stroke);
}

pub fn plus(painter: &Painter, rect: Rect, color: Color32) {
    let stroke = stroke(rect, color);
    painter.line_segment([at(rect, 0.50, 0.14), at(rect, 0.50, 0.86)], stroke);
    painter.line_segment([at(rect, 0.14, 0.50), at(rect, 0.86, 0.50)], stroke);
}
