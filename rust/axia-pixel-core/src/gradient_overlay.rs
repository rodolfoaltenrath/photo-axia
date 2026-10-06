//! Local-grid gradient overlays on the original mask.
use crate::composite::{composite_pixel_values, BlendMode};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

#[derive(Clone, Copy, Debug)]
pub enum GradientKind {
    Linear,
    Reflected,
    Diamond,
    Radial,
    Angle,
}

impl TryFrom<u32> for GradientKind {
    type Error = &'static str;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Linear),
            1 => Ok(Self::Reflected),
            2 => Ok(Self::Diamond),
            3 => Ok(Self::Radial),
            4 => Ok(Self::Angle),
            _ => Err("unsupported-gradient"),
        }
    }
}

#[derive(Clone, Copy)]
pub struct ColorStop {
    pub position: f64,
    pub color: [u8; 4],
}

#[derive(Clone, Copy)]
pub struct OpacityStop {
    pub position: f64,
    pub opacity: f64,
}

pub struct GradientOverlay<'a> {
    pub kind: GradientKind,
    pub colors: &'a [ColorStop],
    pub opacities: &'a [OpacityStop],
    pub cosine: f64,
    pub sine: f64,
    pub angle_radians: f64,
    pub scale: f64,
    pub reverse: bool,
    pub opacity: f64,
    pub blend_mode: BlendMode,
}

fn validate_positions(positions: impl Iterator<Item = f64>, length: usize) -> bool {
    let mut previous = 0.0;
    (2..=32).contains(&length)
        && positions.into_iter().all(|position| {
            let valid = position.is_finite() && (previous..=1.0).contains(&position);
            previous = position;
            valid
        })
}

impl GradientOverlay<'_> {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if !validate_positions(
            self.colors.iter().map(|stop| stop.position),
            self.colors.len(),
        ) || !validate_positions(
            self.opacities.iter().map(|stop| stop.position),
            self.opacities.len(),
        ) || self
            .opacities
            .iter()
            .any(|stop| !stop.opacity.is_finite() || !(0.0..=100.0).contains(&stop.opacity))
            || !self.opacity.is_finite()
            || !(0.0..=100.0).contains(&self.opacity)
            || !self.scale.is_finite()
            || !(1.0..=1000.0).contains(&self.scale)
            || !self.cosine.is_finite()
            || !self.sine.is_finite()
            || !self.angle_radians.is_finite()
            || !(-std::f64::consts::PI..std::f64::consts::PI).contains(&self.angle_radians)
            || self.cosine.abs() > 1.0
            || self.sine.abs() > 1.0
            || (self.cosine * self.cosine + self.sine * self.sine - 1.0).abs() > 1e-12
        {
            return Err("invalid-gradient");
        }
        Ok(())
    }

    pub(crate) fn position(&self, x: usize, y: usize, width: usize, height: usize) -> f64 {
        let radius_x = (width as f64 / 2.0).max(0.5);
        let radius_y = (height as f64 / 2.0).max(0.5);
        let dx = x as f64 + 0.5 - width as f64 / 2.0;
        let dy = y as f64 + 0.5 - height as f64 / 2.0;
        let position = match self.kind {
            GradientKind::Radial => {
                // Preserve the reference JS two-input hypot rounding.
                let a = (dx / radius_x).abs();
                let b = (dy / radius_y).abs();
                let largest = a.max(b);
                if largest == 0.0 {
                    0.0
                } else {
                    let a = a / largest;
                    let b = b / largest;
                    (a * a + b * b).sqrt() * largest
                }
            }
            GradientKind::Angle => {
                ((dy.atan2(dx) - self.angle_radians) / (std::f64::consts::PI * 2.0) + 1.0) % 1.0
            }
            GradientKind::Diamond => dx.abs() / radius_x + dy.abs() / radius_y,
            GradientKind::Linear | GradientKind::Reflected => {
                let extent = (self.cosine.abs() * radius_x + self.sine.abs() * radius_y).max(0.5);
                let linear = 0.5 + (dx * self.cosine + dy * self.sine) / (extent * 2.0);
                match self.kind {
                    GradientKind::Reflected => (linear - 0.5).abs() * 2.0,
                    _ => linear,
                }
            }
        };
        let scaled = 0.5 + (position - 0.5) * 100.0 / self.scale;
        (if self.reverse { 1.0 - scaled } else { scaled }).clamp(0.0, 1.0)
    }

    fn paint(&self, x: f64) -> ([f64; 3], f64) {
        sample_gradient(self.colors, self.opacities, x)
    }
}

pub(crate) fn sample_gradient(
    colors: &[ColorStop],
    opacities: &[OpacityStop],
    x: f64,
) -> ([f64; 3], f64) {
    // Preserve the TS first/last extrapolation after the last stop.
    let (before, after, amount) = interval(colors, |stop| stop.position, x);
    let first = colors[before].color;
    let last = colors[after].color;
    let color = std::array::from_fn(|channel| {
        (f64::from(first[channel])
            + (f64::from(last[channel]) - f64::from(first[channel])) * amount
            + 0.5)
            .floor()
    });
    let first_alpha = f64::from(first[3]) / 255.0;
    let last_alpha = f64::from(last[3]) / 255.0;
    let color_alpha = first_alpha + (last_alpha - first_alpha) * amount;
    let (before, after, amount) = interval(opacities, |stop| stop.position, x);
    let first = opacities[before].opacity;
    let last = opacities[after].opacity;
    (
        color,
        color_alpha * (first + (last - first) * amount) / 100.0,
    )
}

fn interval<T>(stops: &[T], position: fn(&T) -> f64, value: f64) -> (usize, usize, f64) {
    let right = stops.iter().position(|stop| position(stop) >= value);
    let before = right.map_or(0, |index| index.saturating_sub(1));
    let after = right.unwrap_or(stops.len() - 1);
    let span = position(&stops[after]) - position(&stops[before]);
    let amount = if span <= 0.0 {
        0.0
    } else {
        (value - position(&stops[before])) / span
    };
    (before, after, amount)
}

pub fn apply_gradient_overlay_region(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    target: &[u8],
    output: &mut [u8],
    effect: GradientOverlay<'_>,
) -> Result<(), &'static str> {
    effect.validate()?;
    validate_raster_region(
        source.len(),
        source_width,
        source_height,
        region,
        output.len(),
    )?;
    if target.len() != output.len() {
        return Err("invalid-target-length");
    }
    if effect.opacity == 0.0 {
        output.copy_from_slice(target);
        return Ok(());
    }
    for row in 0..region.height {
        for column in 0..region.width {
            let x = region.x + column;
            let y = region.y + row;
            let offset = (row * region.width + column) * 4;
            let pixel: &mut [u8; 4] = (&mut output[offset..offset + 4]).try_into().unwrap();
            pixel.copy_from_slice(&target[offset..offset + 4]);
            let mask = f64::from(source[(y * source_width + x) * 4 + 3]) / 255.0;
            if mask == 0.0 {
                continue;
            }
            let (color, opacity) = effect.paint(effect.position(x, y, source_width, source_height));
            let alpha = (255.0 * mask * opacity * effect.opacity / 100.0 + 0.5).floor();
            composite_pixel_values(pixel, color, alpha, effect.blend_mode);
        }
    }
    Ok(())
}

fn wire_double(record: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(record[offset..offset + 8].try_into().unwrap())
}

/// # Safety
/// Use live `axia_poc_alloc` pairs; output must not overlap any input.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_gradient_overlay_region(
    source_ptr: *const u8,
    source_len: usize,
    source_width: u32,
    source_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    target_ptr: *const u8,
    target_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    colors_ptr: *const u8,
    colors_len: usize,
    opacities_ptr: *const u8,
    opacities_len: usize,
    kind: u32,
    cosine: f64,
    sine: f64,
    scale: f64,
    reverse: u32,
    opacity: f64,
    blend_mode: u32,
    angle_radians: f64,
) -> u32 {
    if [
        source_ptr,
        target_ptr,
        output_ptr.cast_const(),
        colors_ptr,
        opacities_ptr,
    ]
    .iter()
    .any(|ptr| ptr.is_null())
    {
        return 3;
    }
    if [source_len, target_len, output_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
        || !colors_len.is_multiple_of(16)
        || !(32..=512).contains(&colors_len)
        || !opacities_len.is_multiple_of(16)
        || !(32..=512).contains(&opacities_len)
    {
        return 1;
    }
    let Ok(kind) = GradientKind::try_from(kind) else {
        return 2;
    };
    let Ok(blend_mode) = BlendMode::try_from(blend_mode) else {
        return 2;
    };
    if reverse > 1 {
        return 2;
    }
    let region = RasterRegion {
        x: x as usize,
        y: y as usize,
        width: width as usize,
        height: height as usize,
    };
    if target_len != output_len
        || validate_raster_region(
            source_len,
            source_width as usize,
            source_height as usize,
            region,
            output_len,
        )
        .is_err()
    {
        return 1;
    }
    let output_start = output_ptr as usize;
    let Some(output_end) = output_start.checked_add(output_len) else {
        return 1;
    };
    for (pointer, length) in [
        (source_ptr, source_len),
        (target_ptr, target_len),
        (colors_ptr, colors_len),
        (opacities_ptr, opacities_len),
    ] {
        let input_start = pointer as usize;
        let Some(input_end) = input_start.checked_add(length) else {
            return 1;
        };
        if input_start < output_end && output_start < input_end {
            return 5;
        }
    }
    let mut colors = Vec::with_capacity(colors_len / 16);
    for record in std::slice::from_raw_parts(colors_ptr, colors_len)
        .as_chunks::<16>()
        .0
    {
        if record[12..].iter().any(|byte| *byte != 0) {
            return 2;
        }
        colors.push(ColorStop {
            position: wire_double(record, 0),
            color: record[8..12].try_into().unwrap(),
        });
    }
    let opacities: Vec<OpacityStop> = std::slice::from_raw_parts(opacities_ptr, opacities_len)
        .as_chunks::<16>()
        .0
        .iter()
        .map(|record| OpacityStop {
            position: wire_double(record, 0),
            opacity: wire_double(record, 8),
        })
        .collect();
    let effect = GradientOverlay {
        kind,
        colors: &colors,
        opacities: &opacities,
        cosine,
        sine,
        angle_radians,
        scale,
        reverse: reverse == 1,
        opacity,
        blend_mode,
    };
    if effect.validate().is_err() {
        return 2;
    }
    match apply_gradient_overlay_region(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        region,
        std::slice::from_raw_parts(target_ptr, target_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
        effect,
    ) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const COLORS: [ColorStop; 2] = [
        ColorStop {
            position: 0.0,
            color: [0, 0, 0, 255],
        },
        ColorStop {
            position: 1.0,
            color: [255; 4],
        },
    ];
    const OPACITIES: [OpacityStop; 2] = [
        OpacityStop {
            position: 0.0,
            opacity: 100.0,
        },
        OpacityStop {
            position: 1.0,
            opacity: 100.0,
        },
    ];
    fn effect() -> GradientOverlay<'static> {
        GradientOverlay {
            kind: GradientKind::Linear,
            colors: &COLORS,
            opacities: &OPACITIES,
            cosine: 1.0,
            sine: 0.0,
            angle_radians: 0.0,
            scale: 100.0,
            reverse: false,
            opacity: 100.0,
            blend_mode: BlendMode::Normal,
        }
    }
    #[test]
    fn gradient_uses_original_mask_with_zero_fill() {
        let mut output = [0; 4];
        apply_gradient_overlay_region(
            &[40, 60, 80, 101],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            &[0; 4],
            &mut output,
            effect(),
        )
        .unwrap();
        assert_eq!(output, [128, 128, 128, 101]);
    }
    #[test]
    fn tile_position_uses_full_raster_dimensions() {
        let gradient = effect();
        assert_eq!(gradient.position(2, 1, 5, 3), 0.5);
        assert_eq!(gradient.paint(0.5), ([128.0; 3], 1.0));
    }
    #[test]
    fn radial_keeps_center_and_ellipse_axes() {
        let gradient = GradientOverlay {
            kind: GradientKind::Radial,
            ..effect()
        };
        assert_eq!(gradient.position(2, 1, 5, 3), 0.0);
        assert_eq!(gradient.position(1, 0, 3, 1), 0.0);
        assert_eq!(gradient.position(0, 0, 3, 1), 2.0 / 3.0);
        assert_eq!(gradient.position(0, 0, 1, 3), 2.0 / 3.0);
    }
    #[test]
    fn angle_wraps_once_and_keeps_center_convention() {
        let gradient = GradientOverlay {
            kind: GradientKind::Angle,
            ..effect()
        };
        assert_eq!(gradient.position(1, 1, 3, 3), 0.0);
        assert_eq!(gradient.position(2, 1, 3, 3), 0.0);
        assert_eq!(gradient.position(1, 0, 3, 3), 0.75);
        assert_eq!(gradient.position(0, 1, 3, 3), 0.5);
        assert_eq!(gradient.position(1, 2, 3, 3), 0.25);
        let rotated = GradientOverlay {
            angle_radians: -std::f64::consts::PI,
            ..gradient
        };
        assert_eq!(rotated.position(0, 1, 3, 3), 0.0);
    }
    #[test]
    fn invalid_angle_preserves_output() {
        let mut output = [99; 4];
        let invalid = GradientOverlay {
            kind: GradientKind::Angle,
            angle_radians: f64::NAN,
            ..effect()
        };
        assert!(apply_gradient_overlay_region(
            &[40, 60, 80, 255],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },
            &[0; 4],
            &mut output,
            invalid,
        )
        .is_err());
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn invalid_stops_preserve_output() {
        let mut output = [99; 4];
        let bad = [
            OpacityStop {
                position: 0.9,
                opacity: 100.0,
            },
            OpacityStop {
                position: 0.2,
                opacity: 100.0,
            },
        ];
        assert!(apply_gradient_overlay_region(
            &[0; 4],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },
            &[0; 4],
            &mut output,
            GradientOverlay {
                opacities: &bad,
                ..effect()
            }
        )
        .is_err());
        assert_eq!(output, [99; 4]);
    }
}
