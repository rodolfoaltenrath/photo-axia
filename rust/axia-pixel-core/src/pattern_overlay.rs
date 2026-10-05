//! Repeating pattern uses the original mask and absolute raster coordinates.
use crate::composite::{composite_pixel, BlendMode};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

#[derive(Clone, Copy, Debug)]
pub struct PatternRaster<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct PatternOverlay<'a> {
    pub pattern: PatternRaster<'a>,
    pub opacity: f64,
    pub blend_mode: BlendMode,
    // Use TS trig coefficients to preserve texel-boundary parity.
    pub cosine: f64,
    pub sine: f64,
    pub scale_factor: f64,
}

pub(crate) fn validate_pattern(
    length: usize,
    width: usize,
    height: usize,
) -> Result<(), &'static str> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || length > MAX_POC_BYTES
        || width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(4))
            != Some(length)
    {
        return Err("invalid-pattern-raster");
    }
    Ok(())
}

pub(crate) fn validate_parameters(
    opacity: f64,
    cosine: f64,
    sine: f64,
    scale_factor: f64,
) -> Result<(), &'static str> {
    if !opacity.is_finite()
        || !(0.0..=100.0).contains(&opacity)
        || !cosine.is_finite()
        || !sine.is_finite()
        || cosine.abs() > 1.0
        || sine.abs() > 1.0
        || (cosine * cosine + sine * sine - 1.0).abs() > 1e-12
        || !scale_factor.is_finite()
        || !(0.01..=10.0).contains(&scale_factor)
    {
        return Err("invalid-pattern-effect");
    }
    Ok(())
}

fn repeat_coordinate(value: f64, extent: usize) -> usize {
    let extent = extent as f64;
    // Match the TS double remainder, including its rounding near zero/period.
    (((value % extent) + extent) % extent).floor() as usize
}

pub fn apply_pattern_overlay_region(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    target: &[u8],
    output: &mut [u8],
    effect: PatternOverlay<'_>,
) -> Result<(), &'static str> {
    validate_parameters(
        effect.opacity,
        effect.cosine,
        effect.sine,
        effect.scale_factor,
    )?;
    validate_pattern(
        effect.pattern.data.len(),
        effect.pattern.width,
        effect.pattern.height,
    )?;
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
    for row in 0..region.height {
        for column in 0..region.width {
            let x = region.x + column;
            let y = region.y + row;
            let mask = f64::from(source[(y * source_width + x) * 4 + 3]) / 255.0;
            let offset = (row * region.width + column) * 4;
            let pixel: &mut [u8; 4] = (&mut output[offset..offset + 4]).try_into().unwrap();
            pixel.copy_from_slice(&target[offset..offset + 4]);
            if mask == 0.0 {
                continue;
            }
            let x = x as f64;
            let y = y as f64;
            let rotated_x = (x * effect.cosine - y * effect.sine) / effect.scale_factor;
            let rotated_y = (x * effect.sine + y * effect.cosine) / effect.scale_factor;
            let px = repeat_coordinate(rotated_x, effect.pattern.width);
            let py = repeat_coordinate(rotated_y, effect.pattern.height);
            let pattern_offset = (py * effect.pattern.width + px) * 4;
            let color = [
                effect.pattern.data[pattern_offset],
                effect.pattern.data[pattern_offset + 1],
                effect.pattern.data[pattern_offset + 2],
            ];
            let pattern_alpha = f64::from(effect.pattern.data[pattern_offset + 3]) / 255.0;
            let alpha = (255.0 * mask * pattern_alpha * effect.opacity / 100.0 + 0.5).floor() as u8;
            composite_pixel(pixel, color, alpha, effect.blend_mode);
        }
    }
    Ok(())
}

/// # Safety
/// Use live `axia_poc_alloc` pairs; output must not overlap any input.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_pattern_overlay_region(
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
    pattern_ptr: *const u8,
    pattern_len: usize,
    pattern_width: u32,
    pattern_height: u32,
    cosine: f64,
    sine: f64,
    scale_factor: f64,
    opacity: f64,
    blend_mode: u32,
) -> u32 {
    if source_ptr.is_null() || target_ptr.is_null() || output_ptr.is_null() || pattern_ptr.is_null()
    {
        return 3;
    }
    if [source_len, target_len, output_len, pattern_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
    {
        return 1;
    }
    let Ok(blend_mode) = BlendMode::try_from(blend_mode) else {
        return 2;
    };
    if validate_parameters(opacity, cosine, sine, scale_factor).is_err() {
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
        || validate_pattern(pattern_len, pattern_width as usize, pattern_height as usize).is_err()
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
        (pattern_ptr, pattern_len),
    ] {
        let input_start = pointer as usize;
        let Some(input_end) = input_start.checked_add(length) else {
            return 1;
        };
        if input_start < output_end && output_start < input_end {
            return 5;
        }
    }
    match apply_pattern_overlay_region(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        region,
        std::slice::from_raw_parts(target_ptr, target_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
        PatternOverlay {
            pattern: PatternRaster {
                data: std::slice::from_raw_parts(pattern_ptr, pattern_len),
                width: pattern_width as usize,
                height: pattern_height as usize,
            },
            opacity,
            blend_mode,
            cosine,
            sine,
            scale_factor,
        },
    ) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PATTERN: [u8; 8] = [255, 0, 0, 255, 0, 0, 255, 255];
    fn effect() -> PatternOverlay<'static> {
        PatternOverlay {
            pattern: PatternRaster {
                data: &PATTERN,
                width: 2,
                height: 1,
            },
            opacity: 100.0,
            blend_mode: BlendMode::Normal,
            cosine: 1.0,
            sine: 0.0,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn matches_existing_checker_golden_with_zero_fill() {
        let source = [20, 40, 60, 255, 20, 40, 60, 128, 20, 40, 60, 255];
        let mut output = [0; 12];
        apply_pattern_overlay_region(
            &source,
            3,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 3,
                height: 1,
            },
            &[0; 12],
            &mut output,
            effect(),
        )
        .unwrap();
        assert_eq!(output, [255, 0, 0, 255, 0, 0, 255, 128, 255, 0, 0, 255]);
    }

    #[test]
    fn tile_uses_absolute_coordinates_and_negative_rotation_wraps() {
        let source = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
        let mut output = [0; 4];
        apply_pattern_overlay_region(
            &source,
            3,
            1,
            RasterRegion {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
            },
            &[0; 4],
            &mut output,
            PatternOverlay {
                cosine: -1.0,
                ..effect()
            },
        )
        .unwrap();
        assert_eq!(output, [0, 0, 255, 255]);
        assert_eq!(repeat_coordinate(-0.5, 2), 1);
        assert_eq!(repeat_coordinate(-2.0, 2), 0);
    }

    #[test]
    fn invalid_effect_pattern_or_region_preserves_output() {
        let mut output = [99; 4];
        let region = RasterRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        for invalid in [
            PatternOverlay {
                opacity: f64::NAN,
                ..effect()
            },
            PatternOverlay {
                scale_factor: 0.0,
                ..effect()
            },
            PatternOverlay {
                cosine: 0.0,
                ..effect()
            },
            PatternOverlay {
                pattern: PatternRaster {
                    data: &PATTERN,
                    width: 1,
                    height: 1,
                },
                ..effect()
            },
        ] {
            assert!(apply_pattern_overlay_region(
                &[0; 4],
                1,
                1,
                region,
                &[0; 4],
                &mut output,
                invalid
            )
            .is_err());
        }
        assert!(apply_pattern_overlay_region(
            &[0; 4],
            1,
            1,
            RasterRegion { x: 1, ..region },
            &[0; 4],
            &mut output,
            effect()
        )
        .is_err());
        assert_eq!(output, [99; 4]);
    }
}
