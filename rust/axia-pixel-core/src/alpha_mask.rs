//! Shared spread/blur primitives; not a complete shadow or glow.
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const MAX_JOB_BYTES: usize = 96 * 1024 * 1024;
const MAX_RADIUS: usize = 4096;

#[derive(Clone, Copy)]
pub struct AlphaMask {
    pub spread_radius: usize,
    pub blur_radius: usize,
    pub precise: bool,
}

pub(crate) struct AlphaMaskJob {
    pub config: AlphaMask,
    pub offset_x: i32,
    pub offset_y: i32,
    pub extra_bytes: usize,
}

pub(crate) fn context_region(
    width: usize,
    height: usize,
    region: RasterRegion,
    halo: usize,
) -> RasterRegion {
    let x = region.x.saturating_sub(halo);
    let y = region.y.saturating_sub(halo);
    let right = (region.x + region.width).saturating_add(halo).min(width);
    let bottom = (region.y + region.height).saturating_add(halo).min(height);
    RasterRegion {
        x,
        y,
        width: right - x,
        height: bottom - y,
    }
}

pub(crate) fn budget(
    source: usize,
    output: usize,
    context: RasterRegion,
    spread: usize,
) -> Result<(), u32> {
    let masks = context
        .width
        .checked_mul(context.height)
        .and_then(|pixels| pixels.checked_mul(2));
    let queue = if spread > 0 {
        context.width.max(context.height).checked_mul(4)
    } else {
        Some(0)
    };
    let total = source
        .checked_add(output)
        .and_then(|bytes| bytes.checked_add(masks?))
        .and_then(|bytes| bytes.checked_add(queue?))
        .ok_or(6u32)?;
    if total > MAX_JOB_BYTES {
        return Err(6);
    }
    Ok(())
}

fn maximum(
    source: &[u8],
    output: &mut [u8],
    width: usize,
    height: usize,
    radius: usize,
    vertical: bool,
    queue: &mut [u32],
) {
    let (lines, length, stride) = if vertical {
        (width, height, width)
    } else {
        (height, width, 1)
    };
    for line in 0..lines {
        let base = if vertical { line } else { line * width };
        let mut head = 0;
        let mut tail = 0;
        let mut next = 0;
        for position in 0..length {
            let end = (position + radius).min(length - 1);
            while next <= end {
                while tail > head
                    && source[base + queue[tail - 1] as usize * stride]
                        <= source[base + next * stride]
                {
                    tail -= 1;
                }
                queue[tail] = next as u32;
                tail += 1;
                next += 1;
            }
            let start = position.saturating_sub(radius);
            while tail > head && (queue[head] as usize) < start {
                head += 1;
            }
            output[base + position * stride] = source[base + queue[head] as usize * stride];
        }
    }
}

fn box_blur(
    source: &[u8],
    output: &mut [u8],
    width: usize,
    height: usize,
    radius: usize,
    vertical: bool,
) {
    let (lines, length, stride) = if vertical {
        (width, height, width)
    } else {
        (height, width, 1)
    };
    let window = (radius * 2 + 1) as f64;
    for line in 0..lines {
        let base = if vertical { line } else { line * width };
        let mut sum: u32 = (0..=radius.min(length - 1))
            .map(|position| u32::from(source[base + position * stride]))
            .sum();
        for position in 0..length {
            // Each axis rounds before the next pass; missing samples remain zero.
            output[base + position * stride] = (f64::from(sum) / window + 0.5).floor() as u8;
            if position >= radius {
                sum -= u32::from(source[base + (position - radius) * stride]);
            }
            let entering = position + radius + 1;
            if entering < length {
                sum += u32::from(source[base + entering * stride]);
            }
        }
    }
}

pub(crate) fn filtered_alpha_context(
    source: &[u8],
    width: usize,
    height: usize,
    region: RasterRegion,
    output_len: usize,
    job: AlphaMaskJob,
) -> Result<(Vec<u8>, RasterRegion), u32> {
    let AlphaMask {
        spread_radius: spread,
        blur_radius: blur,
        precise,
    } = job.config;
    if source.len() > MAX_POC_BYTES || output_len > MAX_POC_BYTES {
        return Err(1);
    }
    validate_raster_region(source.len(), width, height, region, output_len).map_err(|_| 1u32)?;
    if spread > MAX_RADIUS || blur > MAX_RADIUS {
        return Err(2);
    }
    let context = context_region(width, height, region, spread + blur);
    budget(
        source.len().checked_add(job.extra_bytes).ok_or(6u32)?,
        output_len,
        context,
        spread,
    )?;
    let count = context.width * context.height;
    let mut current = Vec::new();
    let mut scratch = Vec::new();
    let mut queue = Vec::new();
    current.try_reserve_exact(count).map_err(|_| 6u32)?;
    scratch.try_reserve_exact(count).map_err(|_| 6u32)?;
    if spread > 0 {
        let length = context.width.max(context.height);
        queue.try_reserve_exact(length).map_err(|_| 6u32)?;
        queue.resize(length, 0u32);
    }
    current.resize(count, 0);
    scratch.resize(count, 0);
    for y in 0..context.height {
        for x in 0..context.width {
            let source_x = (context.x + x) as i64 - i64::from(job.offset_x);
            let source_y = (context.y + y) as i64 - i64::from(job.offset_y);
            if source_x >= 0 && source_y >= 0 && source_x < width as i64 && source_y < height as i64
            {
                current[y * context.width + x] =
                    source[(source_y as usize * width + source_x as usize) * 4 + 3];
            }
        }
    }
    if spread > 0 {
        maximum(
            &current,
            &mut scratch,
            context.width,
            context.height,
            spread,
            false,
            &mut queue,
        );
        maximum(
            &scratch,
            &mut current,
            context.width,
            context.height,
            spread,
            true,
            &mut queue,
        );
    }
    let passes = if precise {
        [blur, 0, 0]
    } else {
        [blur / 3, (blur + 1) / 3, blur.div_ceil(3)]
    };
    for radius in passes.into_iter().filter(|radius| *radius > 0) {
        box_blur(
            &current,
            &mut scratch,
            context.width,
            context.height,
            radius,
            false,
        );
        box_blur(
            &scratch,
            &mut current,
            context.width,
            context.height,
            radius,
            true,
        );
    }
    Ok((current, context))
}

pub fn apply_alpha_mask_region(
    source: &[u8],
    width: usize,
    height: usize,
    region: RasterRegion,
    output: &mut [u8],
    config: AlphaMask,
) -> Result<(), u32> {
    let (current, context) = filtered_alpha_context(
        source,
        width,
        height,
        region,
        output.len(),
        AlphaMaskJob {
            config,
            offset_x: 0,
            offset_y: 0,
            extra_bytes: 0,
        },
    )?;
    // Crop only after all neighborhood passes have consumed their halo.
    for y in 0..region.height {
        for x in 0..region.width {
            let index = (region.y - context.y + y) * context.width + region.x - context.x + x;
            output[(y * region.width + x) * 4..(y * region.width + x + 1) * 4].copy_from_slice(&[
                0,
                0,
                0,
                current[index],
            ]);
        }
    }
    Ok(())
}

/// # Safety
/// Use live allocator pairs; output must not overlap source.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_alpha_mask_region(
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
    spread: u32,
    blur: u32,
    precise: u32,
) -> u32 {
    if source_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [source_len, output_len]
        .iter()
        .any(|length| *length == 0 || *length > MAX_POC_BYTES || !length.is_multiple_of(4))
    {
        return 1;
    }
    if precise > 1 || spread as usize > MAX_RADIUS || blur as usize > MAX_RADIUS {
        return 2;
    }
    let source_start = source_ptr as usize;
    let output_start = output_ptr as usize;
    let (Some(source_end), Some(output_end)) = (
        source_start.checked_add(source_len),
        output_start.checked_add(output_len),
    ) else {
        return 1;
    };
    if source_start < output_end && output_start < source_end {
        return 5;
    }
    match apply_alpha_mask_region(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        RasterRegion {
            x: x as usize,
            y: y as usize,
            width: width as usize,
            height: height as usize,
        },
        std::slice::from_raw_parts_mut(output_ptr, output_len),
        AlphaMask {
            spread_radius: spread as usize,
            blur_radius: blur as usize,
            precise: precise == 1,
        },
    ) {
        Ok(()) => 0,
        Err(status) => status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blur_keeps_zero_border_and_axis_rounding() {
        let mut source = [0; 36];
        source[19] = 255;
        let mut output = [0; 36];
        apply_alpha_mask_region(
            &source,
            3,
            3,
            RasterRegion {
                x: 0,
                y: 0,
                width: 3,
                height: 3,
            },
            &mut output,
            AlphaMask {
                spread_radius: 0,
                blur_radius: 1,
                precise: false,
            },
        )
        .unwrap();
        for pixel in output.as_chunks::<4>().0 {
            assert_eq!(pixel, &[0, 0, 0, 28]);
        }
    }
    #[test]
    fn tiles_sample_neighbors_outside_output() {
        let source = [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0];
        let mut output = [0; 4];
        apply_alpha_mask_region(
            &source,
            3,
            1,
            RasterRegion {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
            },
            &mut output,
            AlphaMask {
                spread_radius: 1,
                blur_radius: 0,
                precise: false,
            },
        )
        .unwrap();
        assert_eq!(output, [0, 0, 0, 255]);
        apply_alpha_mask_region(
            &source,
            3,
            1,
            RasterRegion {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
            },
            &mut output,
            AlphaMask {
                spread_radius: 0,
                blur_radius: 1,
                precise: false,
            },
        )
        .unwrap();
        assert_eq!(output, [0, 0, 0, 28]);
    }
    #[test]
    fn invalid_input_preserves_output() {
        let mut output = [99; 4];
        assert_eq!(
            apply_alpha_mask_region(
                &[0; 4],
                1,
                1,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },
                &mut output,
                AlphaMask {
                    spread_radius: 4097,
                    blur_radius: 0,
                    precise: false
                }
            ),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn budget_includes_queue_and_both_masks() {
        assert_eq!(
            budget(
                64 * 1024 * 1024,
                4,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 16 * 1024 * 1024,
                    height: 1
                },
                1
            ),
            Err(6)
        );
        assert_eq!(
            budget(
                usize::MAX,
                4,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },
                0
            ),
            Err(6)
        );
    }
}
