//! Visual theme (specification §23, §24).
//!
//! The palette and the metrics are lifted from Visual Studio Code's two
//! built-in default themes — **Light Modern** and **Dark Modern** (§24.3).
//! Token names below match VS Code's `workbench.colorCustomizations` keys, so a
//! value can be checked against the upstream theme file without guesswork.
//!
//! Two rules still govern the status colours:
//!
//! 1. Colour is never the only signal — every badge carries its text label.
//! 2. Both themes must stay legible, so each status has a light and a dark
//!    variant rather than one value that washes out in one of them.

use std::sync::LazyLock;

use egui::{Color32, CornerRadius, FontFamily, FontId, Margin, Stroke, TextStyle};

use crate::view_model::{DisplayStatus, RunStatus};

/// `0xRRGGBB` literal, so the constants below can be read against VS Code's
/// theme JSON character for character.
const fn rgb(hex: u32) -> Color32 {
    Color32::from_rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

const fn rgba(hex: u32, alpha: u8) -> Color32 {
    Color32::from_rgba_unmultiplied_const((hex >> 16) as u8, (hex >> 8) as u8, hex as u8, alpha)
}

/// Workbench metrics, in logical pixels, matching VS Code's own chrome.
pub mod metrics {
    /// Width of the icon strip on the far left.
    pub const ACTIVITY_BAR: f32 = 48.0;
    /// Height of the sidebar's view header, e.g. the `LIBRARY` row.
    pub const VIEW_HEADER: f32 = 35.0;
    /// Height of the bottom status bar.
    pub const STATUS_BAR: f32 = 22.0;
    /// Height of one row in a tree or list.
    pub const ROW: f32 = 22.0;
    /// Height of a button, dropdown, or text field.
    pub const CONTROL: f32 = 26.0;
    /// Side of a square icon-only button.
    pub const ICON_BUTTON: f32 = 24.0;
    /// Height of a collapsible sidebar section header.
    pub const SECTION_HEADER: f32 = 22.0;
    /// Height of the breadcrumb strip above editor content.
    pub const BREADCRUMB: f32 = 22.0;
    /// Padding around the editor's own content.
    pub const EDITOR_PADDING: f32 = 20.0;
    /// Padding between a modal's border and its contents.
    pub const MODAL_PADDING: i8 = 20;
    /// Widest a modal's content may get before it wraps (specification §15.1).
    pub const MODAL_WIDTH: f32 = 460.0;
}

/// Every workbench colour token this application uses.
struct Palette {
    dark: bool,

    // --- surfaces -----------------------------------------------------------
    /// `editor.background`
    editor_bg: Color32,
    /// `sideBar.background`
    side_bar_bg: Color32,
    /// `activityBar.background`
    activity_bar_bg: Color32,
    /// `statusBar.background`
    status_bar_bg: Color32,
    /// `editorWidget.background` — menus, popups, modals.
    widget_bg: Color32,

    // --- borders ------------------------------------------------------------
    /// `sideBar.border`, `titleBar.border`, `statusBar.border`
    border: Color32,
    /// `menu.border`, `input.border`, `dropdown.border`
    control_border: Color32,

    // --- text ---------------------------------------------------------------
    /// `foreground`
    foreground: Color32,
    /// `editor.foreground` — headings and emphasised text.
    strong_foreground: Color32,
    /// `descriptionForeground` — secondary and dimmed text.
    description: Color32,
    /// `activityBar.inactiveForeground`
    icon_inactive: Color32,
    /// `activityBar.foreground`
    icon_active: Color32,

    // --- accents ------------------------------------------------------------
    /// `button.background`, `activityBar.activeBorder`, `focusBorder`
    accent: Color32,
    /// `button.foreground`
    on_accent: Color32,
    /// `textLink.foreground`
    link: Color32,

    // --- controls -----------------------------------------------------------
    /// `input.background`
    input_bg: Color32,
    /// `button.secondaryBackground`
    secondary_bg: Color32,
    /// `button.secondaryHoverBackground`
    secondary_hover_bg: Color32,
    /// `toolbar.activeBackground` — an icon action while it is held down.
    toolbar_active: Color32,

    // --- lists --------------------------------------------------------------
    /// `list.hoverBackground`
    row_hover: Color32,
    /// `list.activeSelectionBackground`
    row_selected: Color32,
    /// `list.activeSelectionForeground`
    row_selected_fg: Color32,

    // --- feedback -----------------------------------------------------------
    /// `editorError.foreground`
    error: Color32,
    /// `editorWarning.foreground`
    warning: Color32,

    // --- charts, used for run status ---------------------------------------
    chart_blue: Color32,
    chart_green: Color32,
    chart_red: Color32,
    chart_yellow: Color32,
    chart_gray: Color32,

    // --- editor -------------------------------------------------------------
    /// `editor.selectionBackground`
    selection_bg: Color32,
    /// `editor.findMatchHighlightBackground`
    find_match_bg: Color32,
    /// `textCodeBlock.background`
    code_bg: Color32,
}

/// VS Code **Light Modern** — the current out-of-the-box light theme.
const LIGHT: Palette = Palette {
    dark: false,

    editor_bg: rgb(0xFFFFFF),
    side_bar_bg: rgb(0xF8F8F8),
    activity_bar_bg: rgb(0xF8F8F8),
    status_bar_bg: rgb(0xF8F8F8),
    widget_bg: rgb(0xF8F8F8),

    border: rgb(0xE5E5E5),
    control_border: rgb(0xCECECE),

    foreground: rgb(0x3B3B3B),
    strong_foreground: rgb(0x1E1E1E),
    description: rgb(0x717171),
    icon_inactive: rgb(0x616161),
    icon_active: rgb(0x1F1F1F),

    accent: rgb(0x005FB8),
    on_accent: rgb(0xFFFFFF),
    link: rgb(0x005FB8),

    input_bg: rgb(0xFFFFFF),
    secondary_bg: rgb(0xE5E5E5),
    secondary_hover_bg: rgb(0xCCCCCC),
    toolbar_active: rgba(0xA6A6A6, 0x80),

    row_hover: rgb(0xF2F2F2),
    row_selected: rgb(0xE8E8E8),
    row_selected_fg: rgb(0x000000),

    error: rgb(0xE51400),
    warning: rgb(0xBF8803),

    chart_blue: rgb(0x1076BC),
    chart_green: rgb(0x388A34),
    chart_red: rgb(0xA1260D),
    chart_yellow: rgb(0xBF8803),
    chart_gray: rgb(0x717171),

    selection_bg: rgb(0xADD6FF),
    find_match_bg: rgba(0xEA5C00, 0x55),
    code_bg: rgba(0x220000, 0x0A),
};

/// VS Code **Dark Modern**, so the Dark setting stays part of the same family.
const DARK: Palette = Palette {
    dark: true,

    editor_bg: rgb(0x1F1F1F),
    side_bar_bg: rgb(0x181818),
    activity_bar_bg: rgb(0x181818),
    status_bar_bg: rgb(0x181818),
    widget_bg: rgb(0x202020),

    border: rgb(0x2B2B2B),
    control_border: rgb(0x3C3C3C),

    foreground: rgb(0xCCCCCC),
    strong_foreground: rgb(0xE7E7E7),
    description: rgb(0x9D9D9D),
    icon_inactive: rgb(0x868686),
    icon_active: rgb(0xD7D7D7),

    accent: rgb(0x0078D4),
    on_accent: rgb(0xFFFFFF),
    link: rgb(0x4DAAFC),

    input_bg: rgb(0x313131),
    secondary_bg: rgb(0x313131),
    secondary_hover_bg: rgb(0x3C3C3C),
    toolbar_active: rgba(0x636667, 0x80),

    row_hover: rgb(0x2A2D2E),
    row_selected: rgb(0x04395E),
    row_selected_fg: rgb(0xFFFFFF),

    error: rgb(0xF85149),
    warning: rgb(0xCCA700),

    chart_blue: rgb(0x3794FF),
    chart_green: rgb(0x89D185),
    chart_red: rgb(0xF14C4C),
    chart_yellow: rgb(0xCCA700),
    chart_gray: rgb(0x9D9D9D),

    selection_bg: rgb(0x264F78),
    find_match_bg: rgba(0xEA5C00, 0x55),
    code_bg: rgba(0xFFFFFF, 0x0F),
};

fn palette(dark_mode: bool) -> &'static Palette {
    if dark_mode { &DARK } else { &LIGHT }
}

/// The palette matching whatever theme this `Ui` is currently drawing in.
fn of(ui: &egui::Ui) -> &'static Palette {
    palette(ui.visuals().dark_mode)
}

/// Register the VS Code styles for both themes.
///
/// Both are registered up front rather than on every theme change, so that
/// `System` following the operating system mid-session picks up the right one
/// without any further work from us.
pub fn install(ctx: &egui::Context) {
    ctx.set_fonts(fonts());
    ctx.set_style_of(egui::Theme::Light, style(&LIGHT));
    ctx.set_style_of(egui::Theme::Dark, style(&DARK));
}

/// Inter, embedded in the binary, in the three cuts the workbench sets type in.
///
/// No typeface ships on every desktop, so reading the platform's own UI face
/// would mean a different-looking application on each one — and a fallback to
/// egui's Ubuntu Light wherever the read failed. Inter is embedded instead: it
/// is the face this kind of tool chrome is normally set in, it is metrically
/// close to the system UI faces VS Code asks for (SF Pro, Segoe UI), and it is
/// SIL OFL 1.1 licensed. `assets/fonts/Inter-LICENSE.txt` travels with it.
///
/// Three files rather than one because egui has no synthetic bold: `strong`
/// shifts a run's colour and leaves its weight alone, so weight as a level of
/// hierarchy (§24.1) has to be a real cut. Static cuts rather than Inter's
/// variable file because each one is drawn for its weight, and because what the
/// screenshot example captures then does not depend on how a variation axis is
/// interpolated.
///
/// Latin coverage is all this application needs. Anything outside it — emoji,
/// stray symbols — still falls through to the fonts egui bundles.
const INTER: &[u8] = include_bytes!("../../assets/fonts/Inter-Regular.ttf");
const INTER_MEDIUM: &[u8] = include_bytes!("../../assets/fonts/Inter-Medium.ttf");
const INTER_SEMI_BOLD: &[u8] = include_bytes!("../../assets/fonts/Inter-SemiBold.ttf");

/// What each cut is registered as. The heavier two become families of their own
/// — egui reaches a weight only by name — which is why nothing below is a
/// `FontFamily::Proportional` with a weight hung off it.
const REGULAR: &str = "Inter";
const MEDIUM: &str = "Inter Medium";
const SEMI_BOLD: &str = "Inter SemiBold";

/// The middle cut: uppercase labels and column headers, which need presence at
/// 11px without turning into headings.
pub fn medium() -> FontFamily {
    static FAMILY: LazyLock<FontFamily> = LazyLock::new(|| FontFamily::Name(MEDIUM.into()));
    FAMILY.clone()
}

/// The heaviest cut: whatever a reader should land on first — a page title, a
/// section heading, the one line in a block that carries its identity.
pub fn semi_bold() -> FontFamily {
    static FAMILY: LazyLock<FontFamily> = LazyLock::new(|| FontFamily::Name(SEMI_BOLD.into()));
    FAMILY.clone()
}

fn fonts() -> egui::FontDefinitions {
    let mut definitions = egui::FontDefinitions::default();

    // egui's own proportional chain, kept before Inter is put in front of it, so
    // that the heavier families can fall back exactly the way the regular one
    // does instead of ending at Inter's last Latin glyph.
    let fallback = definitions
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();

    for (name, bytes) in [
        (REGULAR, INTER),
        (MEDIUM, INTER_MEDIUM),
        (SEMI_BOLD, INTER_SEMI_BOLD),
    ] {
        definitions.font_data.insert(
            name.to_owned(),
            std::sync::Arc::new(egui::FontData::from_static(bytes)),
        );
    }

    definitions
        .families
        .entry(FontFamily::Proportional)
        .or_default()
        .insert(0, REGULAR.to_owned());

    for name in [MEDIUM, SEMI_BOLD] {
        let mut family = vec![name.to_owned()];
        family.extend(fallback.iter().cloned());
        definitions
            .families
            .insert(FontFamily::Name(name.into()), family);
    }

    // Monospace stays on egui's bundled Hack, which is already a code face.
    definitions
}

/// How far the status bar keeps its contents from the window edge.
///
/// It runs the full width of the window and sits against its bottom corners,
/// which the platform rounds — generously so on macOS. Anything closer than the
/// corner radius gets clipped at the ends of the bar.
const WINDOW_CORNER_INSET: i8 = 12;

/// The workbench text size. Control geometry is measured against it.
const UI_FONT_SIZE: f32 = 13.0;

// ---------------------------------------------------------------------------
// Semantic colour
// ---------------------------------------------------------------------------

// Every colour this application draws is reached through the functions below,
// never by naming a token.
//
// The palette is a closed set — a workbench does not need arbitrary colour, and
// the failure mode is not inventing a new shade but *borrowing* an existing one
// for a purpose it was not chosen for. A list's hover wash on a toolbar button,
// a chart's amber on a warning: both look plausible, and both break the moment
// the theme moves. So `Palette`'s fields are private and a caller states the
// purpose instead of the colour. A purpose that does not exist yet is added
// here, deliberately, rather than approximated at the call site.

/// A region's own ground.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    ActivityBar,
    SideBar,
    Editor,
    StatusBar,
    /// Menus, popups, modals — anything floating above the workbench.
    Widget,
}

/// Text and glyphs drawn on a surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    Normal,
    /// A title, or a value that outranks what surrounds it.
    Strong,
    /// Supporting text that must not compete with the content.
    Muted,
    /// Drawn on top of [`accent`].
    OnAccent,
}

/// An icon's two weights. The workbench dims an icon only when it is inactive,
/// never to signal that it is unavailable — a disabled action states itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconState {
    Rest,
    Active,
}

/// A list row's background under the pointer and the route.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowState {
    Rest,
    Hover,
    Selected,
}

/// A control's background as the pointer works on it. Shared by the secondary
/// button and the toolbar icon buttons, so the two cannot drift apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControlState {
    Rest,
    Hover,
    /// Held down.
    Active,
}

/// How loudly the application is speaking about something.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Worth knowing, changes nothing.
    Info,
    /// Worth noticing, and not a failure — a lost query is the case this exists
    /// for (specification §10.3).
    Warning,
    Error,
}

/// Washes behind text in the report viewer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Highlight {
    Selection,
    FindMatch,
}

pub fn surface(ui: &egui::Ui, surface: Surface) -> Color32 {
    let p = of(ui);
    match surface {
        Surface::ActivityBar => p.activity_bar_bg,
        Surface::SideBar => p.side_bar_bg,
        Surface::Editor => p.editor_bg,
        Surface::StatusBar => p.status_bar_bg,
        Surface::Widget => p.widget_bg,
    }
}

pub fn ink(ui: &egui::Ui, ink: Ink) -> Color32 {
    let p = of(ui);
    match ink {
        Ink::Normal => p.foreground,
        Ink::Strong => p.strong_foreground,
        Ink::Muted => p.description,
        Ink::OnAccent => p.on_accent,
    }
}

pub fn icon(ui: &egui::Ui, state: IconState) -> Color32 {
    let p = of(ui);
    match state {
        IconState::Rest => p.icon_inactive,
        IconState::Active => p.icon_active,
    }
}

/// A row's background, or `None` when the row draws no ground of its own.
pub fn row(ui: &egui::Ui, state: RowState) -> Option<Color32> {
    let p = of(ui);
    match state {
        RowState::Rest => None,
        RowState::Hover => Some(p.row_hover),
        RowState::Selected => Some(p.row_selected),
    }
}

/// The text colour a row carries at that state.
pub fn row_ink(ui: &egui::Ui, state: RowState) -> Color32 {
    let p = of(ui);
    match state {
        RowState::Selected => p.row_selected_fg,
        _ => p.foreground,
    }
}

pub fn control(ui: &egui::Ui, state: ControlState) -> Color32 {
    let p = of(ui);
    match state {
        ControlState::Rest => p.secondary_bg,
        ControlState::Hover => p.secondary_hover_bg,
        ControlState::Active => p.toolbar_active,
    }
}

pub fn feedback(ui: &egui::Ui, level: Level) -> Color32 {
    let p = of(ui);
    match level {
        Level::Info => p.description,
        Level::Warning => p.warning,
        Level::Error => p.error,
    }
}

pub fn highlight(ui: &egui::Ui, highlight: Highlight) -> Color32 {
    let p = of(ui);
    match highlight {
        Highlight::Selection => p.selection_bg,
        Highlight::FindMatch => p.find_match_bg,
    }
}

/// The one colour that means "interactive": primary actions, links, the active
/// edge of the activity bar, the run-count badge.
pub fn accent(ui: &egui::Ui) -> Color32 {
    of(ui).accent
}

/// A translucent wash of the foreground, for the status bar's own hover — the
/// only place VS Code tints by opacity rather than by token.
pub fn status_bar_hover(ui: &egui::Ui) -> Color32 {
    of(ui).foreground.gamma_multiply(0.12)
}

/// A 1px hairline, the only border weight VS Code's workbench uses.
pub fn hairline(ui: &egui::Ui) -> Stroke {
    let p = of(ui);
    Stroke::new(1.0, p.border)
}

pub fn activity_bar_frame(ui: &egui::Ui) -> egui::Frame {
    let p = of(ui);
    egui::Frame::new().fill(p.activity_bar_bg)
}

pub fn side_bar_frame(ui: &egui::Ui) -> egui::Frame {
    let p = of(ui);
    egui::Frame::new().fill(p.side_bar_bg)
}

pub fn status_bar_frame(ui: &egui::Ui) -> egui::Frame {
    let p = of(ui);
    egui::Frame::new()
        .fill(p.status_bar_bg)
        .inner_margin(Margin::symmetric(WINDOW_CORNER_INSET, 0))
}

/// Dialog chrome.
///
/// A modal is a window, not a menu: egui's default modal frame is
/// [`egui::Frame::popup`], whose inner margin is `spacing.menu_margin` — edge
/// to edge horizontally, because a menu's rows are full-bleed. A dialog's
/// contents must stand off its border instead, so this states the margin
/// rather than inheriting one meant for something else.
pub fn modal_frame(ui: &egui::Ui) -> egui::Frame {
    let p = of(ui);
    egui::Frame::new()
        .inner_margin(Margin::same(metrics::MODAL_PADDING))
        .corner_radius(CornerRadius::same(5))
        .fill(p.widget_bg)
        .stroke(Stroke::new(1.0, p.control_border))
        .shadow(egui::epaint::Shadow {
            offset: [0, 4],
            blur: 12,
            spread: 0,
            color: rgba(0x000000, if p.dark { 0x66 } else { 0x24 }),
        })
}

pub fn editor_frame(ui: &egui::Ui) -> egui::Frame {
    let p = of(ui);
    egui::Frame::new().fill(p.editor_bg)
}

// ---------------------------------------------------------------------------
// Style construction
// ---------------------------------------------------------------------------

fn style(p: &Palette) -> egui::Style {
    let mut style = egui::Style {
        visuals: visuals(p),
        ..Default::default()
    };

    // VS Code's UI font is 13px; its editor font is 12–14px monospace.
    style.text_styles = [
        (
            TextStyle::Small,
            FontId::new(11.0, FontFamily::Proportional),
        ),
        (
            TextStyle::Body,
            FontId::new(UI_FONT_SIZE, FontFamily::Proportional),
        ),
        (
            TextStyle::Button,
            FontId::new(UI_FONT_SIZE, FontFamily::Proportional),
        ),
        (
            TextStyle::Monospace,
            FontId::new(12.0, FontFamily::Monospace),
        ),
        // The page title is the one place the workbench sets type large, so it
        // carries the weight too — at 20px the regular cut reads as body text
        // that happened to be enlarged.
        (TextStyle::Heading, FontId::new(20.0, semi_bold())),
    ]
    .into();

    let spacing = &mut style.spacing;
    spacing.item_spacing = egui::vec2(8.0, 6.0);
    // Every button, dropdown, and text field is this tall, and carries this
    // padding. VS Code sizes its primary and secondary buttons identically —
    // they differ in colour, never in shape — so nothing here varies by role.
    // `Button::small` would break that, which is why nothing uses it.
    // egui subtracts a widget's border width from this padding and then grows
    // the widget to `interact_size.y`, so the two do not have to agree exactly —
    // whatever space is left inside the frame is centred by
    // [`crate::ui::widgets::button::Button`].
    spacing.button_padding = egui::vec2(11.0, 4.0);
    spacing.interact_size = egui::vec2(40.0, metrics::CONTROL);
    spacing.indent = 16.0;
    spacing.menu_margin = Margin::symmetric(0, 4);
    spacing.window_margin = Margin::same(16);
    spacing.icon_width = 14.0;
    spacing.icon_width_inner = 8.0;
    spacing.scroll = scroll_style();

    style.interaction.selectable_labels = true;
    // Tooltips in VS Code appear promptly and stay put.
    style.interaction.tooltip_delay = 0.4;
    // No decorative motion (specification §24).
    style.animation_time = 0.0;

    style
}

/// Thin overlay scrollbars that only darken on hover, as in the editor.
fn scroll_style() -> egui::style::ScrollStyle {
    let mut scroll = egui::style::ScrollStyle::floating();
    scroll.bar_width = 10.0;
    scroll.floating_width = 10.0;
    scroll.floating_allocated_width = 0.0;
    scroll.handle_min_length = 20.0;
    scroll.foreground_color = false;
    scroll.dormant_handle_opacity = 0.0;
    scroll.active_handle_opacity = 0.6;
    scroll.interact_handle_opacity = 0.9;
    scroll.dormant_background_opacity = 0.0;
    scroll.active_background_opacity = 0.0;
    scroll.interact_background_opacity = 0.0;
    scroll
}

fn visuals(p: &Palette) -> egui::Visuals {
    let base = if p.dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };

    // 2px is VS Code's button radius; everything larger is a floating surface.
    let control_radius = CornerRadius::same(2);

    egui::Visuals {
        widgets: egui::style::Widgets {
            // Panels, separators, and plain labels. `bg_stroke` here is what
            // egui paints between panels, which is exactly the workbench border.
            noninteractive: egui::style::WidgetVisuals {
                bg_fill: p.side_bar_bg,
                weak_bg_fill: p.side_bar_bg,
                bg_stroke: Stroke::new(1.0, p.border),
                fg_stroke: Stroke::new(1.0, p.foreground),
                corner_radius: control_radius,
                expansion: 0.0,
            },
            // A secondary button, dropdown, or text field at rest.
            //
            // `input.border`: without it a white field on the white editor
            // background is nothing but its own placeholder text. egui takes a
            // text field's frame from the same slot as a button's, so this is
            // the one place to set it.
            inactive: egui::style::WidgetVisuals {
                bg_fill: p.secondary_bg,
                weak_bg_fill: p.secondary_bg,
                bg_stroke: Stroke::new(1.0, p.control_border),
                fg_stroke: Stroke::new(1.0, p.foreground),
                corner_radius: control_radius,
                expansion: 0.0,
            },
            hovered: egui::style::WidgetVisuals {
                // `list.hoverBackground`: what a hovered table row is filled
                // with. Buttons take their fill from `weak_bg_fill` instead.
                bg_fill: p.row_hover,
                weak_bg_fill: p.secondary_hover_bg,
                bg_stroke: Stroke::new(1.0, p.control_border),
                fg_stroke: Stroke::new(1.0, p.strong_foreground),
                corner_radius: control_radius,
                expansion: 0.0,
            },
            // Pressed, or focused: VS Code shows a 1px accent focus ring.
            active: egui::style::WidgetVisuals {
                bg_fill: p.secondary_hover_bg,
                weak_bg_fill: p.secondary_hover_bg,
                bg_stroke: Stroke::new(1.0, p.accent),
                fg_stroke: Stroke::new(1.0, p.strong_foreground),
                corner_radius: control_radius,
                expansion: 0.0,
            },
            open: egui::style::WidgetVisuals {
                bg_fill: p.secondary_hover_bg,
                weak_bg_fill: p.secondary_hover_bg,
                bg_stroke: Stroke::new(1.0, p.control_border),
                fg_stroke: Stroke::new(1.0, p.strong_foreground),
                corner_radius: control_radius,
                expansion: 0.0,
            },
        },

        selection: egui::style::Selection {
            bg_fill: p.selection_bg,
            stroke: Stroke::new(
                1.0,
                if p.dark {
                    p.strong_foreground
                } else {
                    rgb(0x000000)
                },
            ),
        },

        dark_mode: p.dark,
        override_text_color: None,
        // `descriptionForeground`: what every `.weak()` label and every text
        // field's placeholder resolves to.
        weak_text_color: Some(p.description),
        hyperlink_color: p.link,

        faint_bg_color: if p.dark {
            rgba(0xFFFFFF, 0x08)
        } else {
            rgba(0x000000, 0x05)
        },
        extreme_bg_color: p.input_bg,
        text_edit_bg_color: Some(p.input_bg),
        code_bg_color: p.code_bg,

        warn_fg_color: p.warning,
        error_fg_color: p.error,

        window_fill: p.widget_bg,
        window_stroke: Stroke::new(1.0, p.control_border),
        window_corner_radius: CornerRadius::same(5),
        window_shadow: egui::epaint::Shadow {
            offset: [0, 4],
            blur: 12,
            spread: 0,
            color: rgba(0x000000, if p.dark { 0x66 } else { 0x24 }),
        },
        popup_shadow: egui::epaint::Shadow {
            offset: [0, 2],
            blur: 8,
            spread: 0,
            color: rgba(0x000000, if p.dark { 0x59 } else { 0x1F }),
        },
        menu_corner_radius: CornerRadius::same(5),

        panel_fill: p.editor_bg,

        button_frame: true,
        collapsing_header_frame: false,
        indent_has_left_vline: false,
        // VS Code lists are plain; density comes from row height, not zebra fill.
        striped: false,
        slider_trailing_fill: true,

        text_cursor: egui::style::TextCursorStyle {
            stroke: Stroke::new(
                1.0,
                if p.dark {
                    p.foreground
                } else {
                    p.strong_foreground
                },
            ),
            ..base.text_cursor
        },

        ..base
    }
}

// ---------------------------------------------------------------------------
// Status colours (specification §23)
// ---------------------------------------------------------------------------

pub struct StatusStyle {
    pub color: Color32,
    /// A hollow marker reads as "not yet real work" — pending, or unknown.
    pub filled: bool,
}

pub fn status_style(dark_mode: bool, display: DisplayStatus) -> StatusStyle {
    match display {
        DisplayStatus::Unknown { .. } => StatusStyle {
            color: palette(dark_mode).chart_yellow,
            filled: false,
        },
        DisplayStatus::Known(status) => StatusStyle {
            color: status_color(dark_mode, status),
            filled: !matches!(status, RunStatus::Pending),
        },
    }
}

/// Mapped onto VS Code's `charts.*` tokens, which is also where its own test
/// and problem indicators take their green, red, and amber from.
pub fn status_color(dark_mode: bool, status: RunStatus) -> Color32 {
    let p = palette(dark_mode);
    match status {
        RunStatus::Starting | RunStatus::Running => p.chart_blue,
        RunStatus::Completed | RunStatus::Succeeded => p.chart_green,
        RunStatus::Analyzing => p.chart_yellow,
        RunStatus::Failed | RunStatus::Error => p.chart_red,
        RunStatus::Cancelling => p.chart_yellow,
        RunStatus::Cancelled | RunStatus::Pending => p.chart_gray,
    }
}
