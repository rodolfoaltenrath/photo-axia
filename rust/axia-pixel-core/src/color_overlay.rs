//! Color overlay uses the original source alpha, not the current target alpha.
use crate::composite::{composite_pixel, BlendMode};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

#[derive(Clone, Copy, Debug)]
pub struct ColorOverlay {
    pub color: [u8; 4],
    pub opacity: f64,
    pub blend_mode: BlendMode,
}

impl ColorOverlay {
    pub(crate) fn validate(self) -> Result<(), &'static str> {
        if !self.opacity.is_finite() || !(0.0..=100.0).contains(&self.opacity) {
            return Err("invalid-effect-opacity");
        }
        Ok(())
    }
}

/// Original mask and composed target are separate, read-only inputs.
pub fn apply_color_overlay_region(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    target: &[u8],
    output: &mut [u8],
    effect: ColorOverlay,
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
    let color = [effect.color[0], effect.color[1], effect.color[2]];
    let color_alpha = f64::from(effect.color[3]) / 255.0;
    for row in 0..region.height {
        for column in 0..region.width {
            let source_index = ((region.y + row) * source_width + region.x + column) * 4;
            let offset = (row * region.width + column) * 4;
            let pixel: &mut [u8; 4] = (&mut output[offset..offset + 4]).try_into().unwrap();
            pixel.copy_from_slice(&target[offset..offset + 4]);
            let mask = f64::from(source[source_index + 3]) / 255.0;
            let alpha = (255.0 * mask * color_alpha * effect.opacity / 100.0 + 0.5).floor() as u8;
            composite_pixel(pixel, color, alpha, effect.blend_mode);
        }
    }
    Ok(())
}

/// # Safety
/// Use live `axia_poc_alloc` pairs; output must not overlap either input.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_color_overlay_region(
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
    red: u32,
    green: u32,
    blue: u32,
    color_alpha: u32,
    opacity: f64,
    blend_mode: u32,
) -> u32 {
    if source_ptr.is_null() || target_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [source_len, target_len, output_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
    {
        return 1;
    }
    let Ok(blend_mode) = BlendMode::try_from(blend_mode) else {
        return 2;
    };
    if [red, green, blue, color_alpha]
        .iter()
        .any(|value| *value > 255)
    {
        return 2;
    }
    let effect = ColorOverlay {
        color: [red as u8, green as u8, blue as u8, color_alpha as u8],
        opacity,
        blend_mode,
    };
    if effect.validate().is_err() {
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
    for (pointer, length) in [(source_ptr, source_len), (target_ptr, target_len)] {
        let input_start = pointer as usize;
        let Some(input_end) = input_start.checked_add(length) else {
            return 1;
        };
        if input_start < output_end && output_start < input_end {
            return 5;
        }
    }
    match apply_color_overlay_region(
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
    const REGION: RasterRegion = RasterRegion {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
    };
    const EFFECT: ColorOverlay = ColorOverlay {
        color: [255, 128, 0, 255],
        opacity: 75.0,
        blend_mode: BlendMode::Normal,
    };

    #[test]
    fn uses_original_mask_when_fill_is_zero() {
        let mut output = [0; 4];
        apply_color_overlay_region(
            &[40, 60, 80, 255],
            1,
            1,
            REGION,
            &[0; 4],
            &mut output,
            EFFECT,
        )
        .unwrap();
        assert_eq!(output, [255, 128, 0, 191]);
    }

    #[test]
    fn matches_existing_overlay_pixel_with_partial_fill() {
        let mut output = [0; 4];
        apply_color_overlay_region(
            &[40, 60, 80, 255],
            1,
            1,
            REGION,
            &[40, 60, 80, 153],
            &mut output,
            EFFECT,
        )
        .unwrap();
        assert_eq!(output, [219, 117, 13, 229]);
    }

    #[test]
    fn invalid_opacity_or_target_preserves_output() {
        let mut output = [99; 4];
        for opacity in [-1.0, 101.0, f64::NAN, f64::INFINITY] {
            assert!(apply_color_overlay_region(
                &[0; 4],
                1,
                1,
                REGION,
                &[0; 4],
                &mut output,
                ColorOverlay { opacity, ..EFFECT }
            )
            .is_err());
        }
        assert!(
            apply_color_overlay_region(&[0; 4], 1, 1, REGION, &[0; 3], &mut output, EFFECT)
                .is_err()
        );
        assert_eq!(output, [99; 4]);
    }
}
