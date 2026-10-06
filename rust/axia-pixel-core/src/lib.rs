//! Experimental pixel ABI; not the document compositor.

pub mod alpha_mask;
pub mod batch;
pub mod blend_if;
pub mod color_overlay;
pub mod composite;
pub mod drop_shadow;
mod effect_math;
pub mod glow;
pub mod gradient_overlay;
pub mod pattern_overlay;
pub mod satin;
pub mod stroke;

/// Zero-alpha fill pixels must not retain hidden RGB.
pub fn apply_fill_opacity_in_place(rgba: &mut [u8], fill_opacity: u8) -> Result<(), &'static str> {
    if rgba.is_empty() || !rgba.len().is_multiple_of(4) {
        return Err("invalid-rgba-length");
    }
    if fill_opacity > 100 {
        return Err("invalid-fill-opacity");
    }
    let fill = f64::from(fill_opacity) / 100.0;
    for pixel in rgba.as_chunks_mut::<4>().0 {
        // Preserve TS operation order and half-up rounding.
        let alpha = (f64::from(pixel[3]) * fill + 0.5).floor() as u8;
        if alpha == 0 {
            pixel.fill(0);
        } else {
            pixel[3] = alpha;
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RasterRegion {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

/// Validate before writing; sample absolute source coordinates.
pub fn apply_fill_opacity_region(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    output: &mut [u8],
    fill_opacity: u8,
) -> Result<(), &'static str> {
    apply_fill_opacity_region_fractional(
        source,
        source_width,
        source_height,
        region,
        output,
        f64::from(fill_opacity),
    )
}

pub(crate) fn apply_fill_opacity_region_fractional(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    output: &mut [u8],
    fill_opacity: f64,
) -> Result<(), &'static str> {
    if !fill_opacity.is_finite() || !(0.0..=100.0).contains(&fill_opacity) {
        return Err("invalid-fill-opacity");
    }
    validate_raster_region(
        source.len(),
        source_width,
        source_height,
        region,
        output.len(),
    )?;
    let fill = fill_opacity / 100.0;
    for row in 0..region.height {
        for column in 0..region.width {
            let source_index = ((region.y + row) * source_width + region.x + column) * 4;
            let output_index = (row * region.width + column) * 4;
            let pixel = &source[source_index..source_index + 4];
            let target = &mut output[output_index..output_index + 4];
            let alpha = (f64::from(pixel[3]) * fill + 0.5).floor() as u8;
            if alpha == 0 {
                target.fill(0);
            } else {
                target.copy_from_slice(pixel);
                target[3] = alpha;
            }
        }
    }
    Ok(())
}

fn validate_raster_region(
    source_len: usize,
    source_width: usize,
    source_height: usize,
    region: RasterRegion,
    output_len: usize,
) -> Result<(), &'static str> {
    let source_bytes = source_width
        .checked_mul(source_height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("invalid-rgba-length")?;
    let output_bytes = region
        .width
        .checked_mul(region.height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("invalid-rgba-length")?;
    if source_width == 0
        || source_height == 0
        || source_len != source_bytes
        || output_len != output_bytes
    {
        return Err("invalid-rgba-length");
    }
    if region.width == 0
        || region.height == 0
        || region
            .x
            .checked_add(region.width)
            .is_none_or(|right| right > source_width)
        || region
            .y
            .checked_add(region.height)
            .is_none_or(|bottom| bottom > source_height)
    {
        return Err("invalid-region");
    }

    Ok(())
}

const MAX_POC_BYTES: usize = 64 * 1024 * 1024;

/// Private adapter only; null means allocation failed.
#[no_mangle]
pub extern "C" fn axia_poc_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return std::ptr::null_mut();
    }
    let layout = std::alloc::Layout::array::<u8>(len).expect("bounded RGBA length");
    unsafe { std::alloc::alloc_zeroed(layout) }
}

/// # Safety
/// Free an exact live `axia_poc_alloc` pair only once.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return;
    }
    let layout = std::alloc::Layout::array::<u8>(len).expect("bounded RGBA length");
    std::alloc::dealloc(ptr, layout);
}

/// # Safety
/// `ptr` and `len` must identify a live allocation from `axia_poc_alloc`.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_fill_opacity(ptr: *mut u8, len: usize, fill_opacity: u32) -> u32 {
    if ptr.is_null() {
        return 3;
    }
    if len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return 1;
    }
    if fill_opacity > 100 {
        return 2;
    }
    let rgba = std::slice::from_raw_parts_mut(ptr, len);
    match apply_fill_opacity_in_place(rgba, fill_opacity as u8) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

/// # Safety
/// Both pointer/length pairs must be live allocations from `axia_poc_alloc`.
/// Buffers must not overlap; free each allocation once.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_fill_opacity_region(
    source_ptr: *const u8,
    source_len: usize,
    source_width: u32,
    source_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    output_ptr: *mut u8,
    output_len: usize,
    fill_opacity: u32,
) -> u32 {
    if source_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if source_len == 0
        || source_len > MAX_POC_BYTES
        || !source_len.is_multiple_of(4)
        || output_len == 0
        || output_len > MAX_POC_BYTES
        || !output_len.is_multiple_of(4)
    {
        return 1;
    }
    if fill_opacity > 100 {
        return 2;
    }
    let region = RasterRegion {
        x: x as usize,
        y: y as usize,
        width: width as usize,
        height: height as usize,
    };
    if region.width == 0
        || region.height == 0
        || region
            .x
            .checked_add(region.width)
            .is_none_or(|right| right > source_width as usize)
        || region
            .y
            .checked_add(region.height)
            .is_none_or(|bottom| bottom > source_height as usize)
    {
        return 4;
    }
    let source_start = source_ptr as usize;
    let output_start = output_ptr as usize;
    let Some(source_end) = source_start.checked_add(source_len) else {
        return 1;
    };
    let Some(output_end) = output_start.checked_add(output_len) else {
        return 1;
    };
    if source_start < output_end && output_start < source_end {
        return 5;
    }
    let source = std::slice::from_raw_parts(source_ptr, source_len);
    let output = std::slice::from_raw_parts_mut(output_ptr, output_len);
    match apply_fill_opacity_region(
        source,
        source_width as usize,
        source_height as usize,
        region,
        output,
        fill_opacity as u8,
    ) {
        Ok(()) => 0,
        Err("invalid-fill-opacity") => 2,
        Err("invalid-region") => 4,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_opacity_matches_the_existing_golden() {
        let mut rgba = [10, 20, 30, 101, 90, 80, 70, 255];
        apply_fill_opacity_in_place(&mut rgba, 50).unwrap();
        assert_eq!(rgba, [10, 20, 30, 51, 90, 80, 70, 128]);
    }

    #[test]
    fn transparent_rgb_does_not_leak() {
        let mut rgba = [200, 100, 50, 0, 40, 30, 20, 1];
        apply_fill_opacity_in_place(&mut rgba, 1).unwrap();
        assert_eq!(rgba, [0; 8]);
    }

    #[test]
    fn invalid_input_is_rejected_before_mutation() {
        let mut rgba = [10, 20, 30, 255];
        assert!(apply_fill_opacity_in_place(&mut rgba, 101).is_err());
        assert_eq!(rgba, [10, 20, 30, 255]);
        assert!(apply_fill_opacity_in_place(&mut rgba[..3], 50).is_err());
    }

    #[test]
    fn region_tiles_reassemble_to_the_full_raster() {
        let mut source = vec![0; 7 * 5 * 4];
        for (index, pixel) in source.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            pixel.copy_from_slice(&[
                (index * 17) as u8,
                (index * 31) as u8,
                (index * 47) as u8,
                (index * 19) as u8,
            ]);
        }
        let mut expected = source.clone();
        apply_fill_opacity_in_place(&mut expected, 37).unwrap();
        let mut assembled = vec![0; source.len()];
        for y in (0..5).step_by(2) {
            for x in (0..7).step_by(3) {
                let region = RasterRegion {
                    x,
                    y,
                    width: (7 - x).min(3),
                    height: (5 - y).min(2),
                };
                let mut tile = vec![0; region.width * region.height * 4];
                apply_fill_opacity_region(&source, 7, 5, region, &mut tile, 37).unwrap();
                for row in 0..region.height {
                    let destination = ((y + row) * 7 + x) * 4;
                    let tile_row = row * region.width * 4;
                    assembled[destination..destination + region.width * 4]
                        .copy_from_slice(&tile[tile_row..tile_row + region.width * 4]);
                }
            }
        }
        assert_eq!(assembled, expected);
    }

    #[test]
    fn invalid_region_preserves_output() {
        let source = [10, 20, 30, 255, 40, 50, 60, 0];
        let mut output = [99, 99, 99, 99];
        let region = RasterRegion {
            x: 2,
            y: 0,
            width: 1,
            height: 1,
        };
        assert_eq!(
            apply_fill_opacity_region(&source, 2, 1, region, &mut output, 50),
            Err("invalid-region")
        );
        assert_eq!(output, [99; 4]);
    }
}
