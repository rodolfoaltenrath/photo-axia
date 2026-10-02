//! Underlying-layer Blend If pass on aligned straight-alpha RGBA8 buffers.
//! The backdrop is a compact tile of the already-composed lower layers.

use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

#[derive(Clone, Copy, Debug)]
pub enum BlendIfChannel {
    Gray,
    Red,
    Green,
    Blue,
}

impl TryFrom<u32> for BlendIfChannel {
    type Error = &'static str;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Gray),
            1 => Ok(Self::Red),
            2 => Ok(Self::Green),
            3 => Ok(Self::Blue),
            _ => Err("invalid-blend-if-channel"),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct UnderlyingBlendIf {
    pub channel: BlendIfChannel,
    pub shadows: [u8; 2],
    pub highlights: [u8; 2],
}

impl UnderlyingBlendIf {
    fn validate(self) -> Result<(), &'static str> {
        if self.shadows[0] > self.shadows[1]
            || self.shadows[1] > self.highlights[0]
            || self.highlights[0] > self.highlights[1]
        {
            return Err("invalid-blend-if-range");
        }
        Ok(())
    }

    fn opacity(self, backdrop: &[u8]) -> f64 {
        // Keep TS's evaluation order and f64 precision, including gray luma.
        let value = match self.channel {
            BlendIfChannel::Gray => {
                f64::from(backdrop[0]) * 0.2126
                    + f64::from(backdrop[1]) * 0.7152
                    + f64::from(backdrop[2]) * 0.0722
            }
            BlendIfChannel::Red => f64::from(backdrop[0]),
            BlendIfChannel::Green => f64::from(backdrop[1]),
            BlendIfChannel::Blue => f64::from(backdrop[2]),
        }
        .clamp(0.0, 255.0);
        let mut opacity: f64 = 1.0;
        if self.shadows[1] > 0 {
            let start = f64::from(self.shadows[0]);
            let end = f64::from(self.shadows[1]);
            opacity = opacity.min(if start == end {
                f64::from(value > end)
            } else {
                (value - start) / (end - start)
            });
        }
        if self.highlights[0] < 255 {
            let start = f64::from(self.highlights[0]);
            let end = f64::from(self.highlights[1]);
            opacity = opacity.min(if start == end {
                f64::from(value < start)
            } else {
                (end - value) / (end - start)
            });
        }
        opacity.clamp(0.0, 1.0)
    }
}

/// Copies a source region and changes only alpha, matching the existing TS pass.
/// Hidden RGB is preserved even when alpha becomes zero. Backdrop alpha is not
/// used by the current algorithm; do not silently change that during the port.
pub fn apply_underlying_region(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    backdrop: &[u8],
    output: &mut [u8],
    config: UnderlyingBlendIf,
) -> Result<(), &'static str> {
    config.validate()?;
    validate_raster_region(
        source.len(),
        source_width,
        source_height,
        region,
        output.len(),
    )?;
    if backdrop.len() != output.len() {
        return Err("invalid-backdrop-length");
    }
    for row in 0..region.height {
        for column in 0..region.width {
            let source_index = ((region.y + row) * source_width + region.x + column) * 4;
            let offset = (row * region.width + column) * 4;
            let pixel = &source[source_index..source_index + 4];
            let target = &mut output[offset..offset + 4];
            target.copy_from_slice(pixel);
            if pixel[3] != 0 {
                target[3] = (f64::from(pixel[3]) * config.opacity(&backdrop[offset..offset + 4])
                    + 0.5)
                    .floor() as u8;
            }
        }
    }
    Ok(())
}

/// Returns 0 on success, 1 for invalid lengths/region, 2 for invalid config,
/// 3 for null pointers, 5 for overlap between output and either input.
/// # Safety
/// All pointer/length pairs must be live allocations from `axia_poc_alloc`.
/// Output must be distinct from both inputs. The private JS adapter owns them.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_blend_if_underlying_region(
    source_ptr: *const u8,
    source_len: usize,
    source_width: u32,
    source_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    backdrop_ptr: *const u8,
    backdrop_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    channel: u32,
    shadow_start: u32,
    shadow_end: u32,
    highlight_start: u32,
    highlight_end: u32,
) -> u32 {
    if source_ptr.is_null() || backdrop_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [source_len, backdrop_len, output_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
    {
        return 1;
    }
    let Ok(channel) = BlendIfChannel::try_from(channel) else {
        return 2;
    };
    if [shadow_start, shadow_end, highlight_start, highlight_end]
        .iter()
        .any(|value| *value > 255)
    {
        return 2;
    }
    let config = UnderlyingBlendIf {
        channel,
        shadows: [shadow_start as u8, shadow_end as u8],
        highlights: [highlight_start as u8, highlight_end as u8],
    };
    if config.validate().is_err() {
        return 2;
    }
    let region = RasterRegion {
        x: x as usize,
        y: y as usize,
        width: width as usize,
        height: height as usize,
    };
    if backdrop_len != output_len
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
    for (pointer, length) in [(source_ptr, source_len), (backdrop_ptr, backdrop_len)] {
        let input_start = pointer as usize;
        let Some(input_end) = input_start.checked_add(length) else {
            return 1;
        };
        if input_start < output_end && output_start < input_end {
            return 5;
        }
    }
    match apply_underlying_region(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        region,
        std::slice::from_raw_parts(backdrop_ptr, backdrop_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
        config,
    ) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: UnderlyingBlendIf = UnderlyingBlendIf {
        channel: BlendIfChannel::Red,
        shadows: [50, 100],
        highlights: [255, 255],
    };
    const REGION: RasterRegion = RasterRegion {
        x: 0,
        y: 0,
        width: 3,
        height: 1,
    };

    #[test]
    fn existing_golden_and_hidden_rgb_are_preserved() {
        let source = [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255];
        let backdrop = [50, 255, 255, 255, 75, 0, 0, 255, 100, 0, 0, 255];
        let mut output = [0; 12];
        apply_underlying_region(&source, 3, 1, REGION, &backdrop, &mut output, CONFIG).unwrap();
        assert_eq!(output, [10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255]);
    }

    #[test]
    fn hard_thresholds_exclude_the_boundary_and_ignore_backdrop_alpha() {
        let source = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 0];
        let backdrop = [100, 0, 0, 0, 101, 0, 0, 0, 102, 0, 0, 255];
        let mut output = [0; 12];
        let config = UnderlyingBlendIf {
            shadows: [100, 100],
            ..CONFIG
        };
        apply_underlying_region(&source, 3, 1, REGION, &backdrop, &mut output, config).unwrap();
        assert_eq!(output, [1, 2, 3, 0, 4, 5, 6, 255, 7, 8, 9, 0]);
    }

    #[test]
    fn invalid_range_or_backdrop_preserves_output() {
        let mut output = [99; 12];
        let config = UnderlyingBlendIf {
            shadows: [100, 50],
            ..CONFIG
        };
        assert_eq!(
            apply_underlying_region(&[0; 12], 3, 1, REGION, &[0; 12], &mut output, config),
            Err("invalid-blend-if-range")
        );
        assert_eq!(
            apply_underlying_region(&[0; 12], 3, 1, REGION, &[0; 8], &mut output, CONFIG),
            Err("invalid-backdrop-length")
        );
        assert_eq!(output, [99; 12]);
    }
}
