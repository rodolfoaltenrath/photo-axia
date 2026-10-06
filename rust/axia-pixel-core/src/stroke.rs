//! Circular expansion and square erosion on a prepared source grid.
use crate::alpha_mask::context_region;
use crate::composite::{composite_pixel_values, BlendMode};
use crate::gradient_overlay::{
    sample_gradient, ColorStop, GradientKind, GradientOverlay, OpacityStop,
};
use crate::pattern_overlay::{
    sample_pattern, validate_parameters, validate_pattern, PatternOverlay, PatternRaster,
};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 96;
const MAX_JOB_BYTES: usize = 96 * 1024 * 1024;
const METADATA_BYTES: usize = 2048;

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

struct SpatialGradient {
    colors: Vec<ColorStop>,
    opacities: Vec<OpacityStop>,
    kind: GradientKind,
    cosine: f64,
    sine: f64,
    radians: f64,
    scale: f64,
    reverse: bool,
}
impl SpatialGradient {
    fn overlay(&self) -> GradientOverlay<'_> {
        GradientOverlay {
            colors: &self.colors,
            opacities: &self.opacities,
            kind: self.kind,
            cosine: self.cosine,
            sine: self.sine,
            angle_radians: self.radians,
            scale: self.scale,
            reverse: self.reverse,
            opacity: 100.0,
            blend_mode: BlendMode::Normal,
        }
    }
}
enum Paint<'a> {
    Color([f64; 3], f64),
    Gradient(SpatialGradient),
    Pattern(PatternOverlay<'a>),
    Missing,
}
struct Stroke<'a> {
    outside: usize,
    inside: usize,
    opacity: f64,
    mode: BlendMode,
    paint: Paint<'a>,
}

fn parse(packet: &[u8]) -> Result<Stroke<'_>, u32> {
    if !(HEADER..=MAX_POC_BYTES).contains(&packet.len()) {
        return Err(1);
    }
    if integer(packet, 0) != 0x314b5453 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let outside = integer(packet, 8) as usize;
    let inside = integer(packet, 12) as usize;
    let kind = integer(packet, 16);
    let mode = BlendMode::try_from(integer(packet, 20)).map_err(|_| 2u32)?;
    let gradient_kind = integer(packet, 28);
    let reverse = integer(packet, 32);
    let color_count = integer(packet, 36) as usize;
    let opacity_count = integer(packet, 40) as usize;
    let pattern_width = integer(packet, 44) as usize;
    let pattern_height = integer(packet, 48) as usize;
    let pattern_length = integer(packet, 52) as usize;
    let opacity = double(packet, 56);
    let cosine = double(packet, 64);
    let sine = double(packet, 72);
    let scale = double(packet, 80);
    let radians = double(packet, 88);
    if outside > 4096
        || inside > 4096
        || outside + inside == 0
        || outside + inside > 4096
        || kind > 3
        || reverse > 1
        || !opacity.is_finite()
        || !(0.0..=100.0).contains(&opacity)
        || [cosine, sine, scale, radians]
            .iter()
            .any(|v| !v.is_finite())
    {
        return Err(2);
    }
    if color_count > 32 || opacity_count > 32 || pattern_length > MAX_POC_BYTES {
        return Err(1);
    }
    let expected = HEADER
        .checked_add((color_count + opacity_count) * 16)
        .and_then(|v| v.checked_add(pattern_length))
        .ok_or(1u32)?;
    if packet.len() != expected {
        return Err(1);
    }
    if kind != 1
        && (gradient_kind != 0
            || reverse != 0
            || color_count != 0
            || opacity_count != 0
            || radians != 0.0)
    {
        return Err(2);
    }
    if kind != 2 && (pattern_width != 0 || pattern_height != 0 || pattern_length != 0) {
        return Err(2);
    }
    if kind != 0 && packet[24..28].iter().any(|v| *v != 0) {
        return Err(2);
    }
    let paint = match kind {
        0 | 3 => {
            if cosine != 1.0 || sine != 0.0 || scale != 1.0 {
                return Err(2);
            }
            if kind == 3 {
                Paint::Missing
            } else {
                Paint::Color(
                    [packet[24], packet[25], packet[26]].map(f64::from),
                    f64::from(packet[27]) / 255.0,
                )
            }
        }
        1 => {
            if !(2..=32).contains(&color_count) || !(2..=32).contains(&opacity_count) {
                return Err(2);
            }
            let mut colors = Vec::new();
            let mut opacities = Vec::new();
            colors.try_reserve_exact(color_count).map_err(|_| 6u32)?;
            opacities
                .try_reserve_exact(opacity_count)
                .map_err(|_| 6u32)?;
            let end = HEADER + color_count * 16;
            for stop in packet[HEADER..end].as_chunks::<16>().0 {
                if stop[12..].iter().any(|v| *v != 0) {
                    return Err(2);
                }
                colors.push(ColorStop {
                    position: double(stop, 0),
                    color: stop[8..12].try_into().unwrap(),
                });
            }
            for stop in packet[end..].as_chunks::<16>().0 {
                opacities.push(OpacityStop {
                    position: double(stop, 0),
                    opacity: double(stop, 8),
                });
            }
            let value = SpatialGradient {
                colors,
                opacities,
                kind: GradientKind::try_from(gradient_kind).map_err(|_| 2u32)?,
                cosine,
                sine,
                radians,
                scale,
                reverse: reverse == 1,
            };
            value.overlay().validate().map_err(|_| 2u32)?;
            Paint::Gradient(value)
        }
        2 => {
            validate_parameters(opacity, cosine, sine, scale).map_err(|_| 2u32)?;
            validate_pattern(pattern_length, pattern_width, pattern_height).map_err(|_| 2u32)?;
            Paint::Pattern(PatternOverlay {
                pattern: PatternRaster {
                    data: &packet[HEADER..],
                    width: pattern_width,
                    height: pattern_height,
                },
                cosine,
                sine,
                scale_factor: scale,
                opacity,
                blend_mode: mode,
            })
        }
        _ => unreachable!(),
    };
    Ok(Stroke {
        outside,
        inside,
        opacity,
        mode,
        paint,
    })
}

fn working_bytes(
    source: usize,
    output: usize,
    packet: usize,
    context: RasterRegion,
    outside: usize,
    inside: usize,
) -> Result<usize, u32> {
    let axis = context.width.max(context.height);
    let pixels = context.width.checked_mul(context.height).ok_or(6u32)?;
    let masks = pixels.checked_mul(3).ok_or(6u32)?;
    let distance = if outside > 0 {
        pixels
            .checked_mul(4)
            .and_then(|v| v.checked_add(axis.checked_mul(20)?))
            .and_then(|v| v.checked_add(8))
            .ok_or(6u32)?
    } else {
        0
    };
    let queue = if inside > 0 {
        axis.checked_add(inside * 2)
            .and_then(|v| v.checked_mul(4))
            .ok_or(6u32)?
    } else {
        0
    };
    let total = source
        .checked_add(output.checked_mul(2).ok_or(6u32)?)
        .and_then(|v| v.checked_add(packet))
        .and_then(|v| v.checked_add(METADATA_BYTES))
        .and_then(|v| v.checked_add(masks))
        .and_then(|v| v.checked_add(distance))
        .and_then(|v| v.checked_add(queue))
        .ok_or(6u32)?;
    if total > MAX_JOB_BYTES {
        return Err(6);
    }
    Ok(total)
}

fn reserve<T: Clone>(length: usize, value: T) -> Result<Vec<T>, u32> {
    let mut result = Vec::new();
    result.try_reserve_exact(length).map_err(|_| 6u32)?;
    result.resize(length, value);
    Ok(result)
}

fn distance_1d(input: &[i32], output: &mut [i32], sites: &mut [u32], boundaries: &mut [f64]) {
    let mut active = 0usize;
    sites[0] = 0;
    boundaries[0] = f64::NEG_INFINITY;
    boundaries[1] = f64::INFINITY;
    for point in 1..input.len() {
        let boundary = |site: usize| {
            ((f64::from(input[point]) + (point * point) as f64)
                - (f64::from(input[site]) + (site * site) as f64))
                / (2 * point - 2 * site) as f64
        };
        let mut value = boundary(sites[active] as usize);
        while value <= boundaries[active] {
            active -= 1;
            value = boundary(sites[active] as usize);
        }
        active += 1;
        sites[active] = point as u32;
        boundaries[active] = value;
        boundaries[active + 1] = f64::INFINITY;
    }
    active = 0;
    for (point, value) in output.iter_mut().enumerate() {
        while boundaries[active + 1] < point as f64 {
            active += 1;
        }
        let site = sites[active] as usize;
        let delta = point as i64 - site as i64;
        *value = (delta * delta + i64::from(input[site])) as i32;
    }
}

fn minimum(
    source: &[u8],
    output: &mut [u8],
    context: RasterRegion,
    radius: usize,
    vertical: bool,
    queue: &mut [u32],
) {
    let (lines, length, stride) = if vertical {
        (context.width, context.height, context.width)
    } else {
        (context.height, context.width, 1)
    };
    let window = radius * 2 + 1;
    for line in 0..lines {
        let base = if vertical { line } else { line * context.width };
        let value_at = |index: usize| {
            if index < radius || index >= radius + length {
                0
            } else {
                source[base + (index - radius) * stride]
            }
        };
        let mut head = 0usize;
        let mut tail = 0usize;
        for index in 0..length + 2 * radius {
            let value = value_at(index);
            while tail > head && value_at(queue[tail - 1] as usize) >= value {
                tail -= 1;
            }
            queue[tail] = index as u32;
            tail += 1;
            while tail > head && index >= window && queue[head] as usize <= index - window {
                head += 1;
            }
            if index >= window - 1 {
                output[base + (index + 1 - window) * stride] = value_at(queue[head] as usize);
            }
        }
    }
}

pub fn apply_stroke_region(
    source: &[u8],
    width: usize,
    height: usize,
    region: RasterRegion,
    target: &[u8],
    packet: &[u8],
    output: &mut [u8],
) -> Result<(), u32> {
    if source.len() > MAX_POC_BYTES || target.len() > MAX_POC_BYTES || target.len() != output.len()
    {
        return Err(1);
    }
    validate_raster_region(source.len(), width, height, region, output.len()).map_err(|_| 1u32)?;
    let effect = parse(packet)?;
    if matches!(effect.paint, Paint::Missing) {
        working_bytes(
            source.len(),
            output.len(),
            packet.len(),
            RasterRegion {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            },
            0,
            0,
        )?;
        output.copy_from_slice(target);
        return Ok(());
    }
    let maximum = if effect.outside > 0 {
        width
            .checked_mul(width)
            .and_then(|v| v.checked_add(height.checked_mul(height)?))
            .and_then(|v| v.checked_add(1))
            .filter(|v| *v <= i32::MAX as usize)
            .ok_or(2u32)? as i32
    } else {
        0
    };
    let context = context_region(width, height, region, effect.outside.max(effect.inside));
    working_bytes(
        source.len(),
        output.len(),
        packet.len(),
        context,
        effect.outside,
        effect.inside,
    )?;
    let count = context.width * context.height;
    let axis = context.width.max(context.height);
    let mut alpha = reserve(count, 0u8)?;
    let mut expanded = reserve(count, 0u8)?;
    let mut scratch = reserve(count, 0u8)?;
    let mut distances = reserve(if effect.outside > 0 { count } else { 0 }, 0i32)?;
    let line_size = if effect.outside > 0 { axis } else { 0 };
    let mut input = reserve(line_size, 0i32)?;
    let mut line = reserve(line_size, 0i32)?;
    let mut sites = reserve(line_size, 0u32)?;
    let mut boundaries = reserve(if line_size > 0 { line_size + 1 } else { 0 }, 0.0)?;
    let mut queue = reserve(
        if effect.inside > 0 {
            axis + effect.inside * 2
        } else {
            0
        },
        0u32,
    )?;
    for y in 0..context.height {
        for x in 0..context.width {
            alpha[y * context.width + x] =
                source[((context.y + y) * width + context.x + x) * 4 + 3];
        }
    }
    if effect.outside > 0 {
        for x in 0..context.width {
            for y in 0..context.height {
                input[y] = if alpha[y * context.width + x] > 0 {
                    0
                } else {
                    maximum
                };
            }
            distance_1d(
                &input[..context.height],
                &mut line[..context.height],
                &mut sites,
                &mut boundaries,
            );
            for y in 0..context.height {
                distances[y * context.width + x] = line[y];
            }
        }
        for y in 0..context.height {
            input[..context.width]
                .copy_from_slice(&distances[y * context.width..(y + 1) * context.width]);
            distance_1d(
                &input[..context.width],
                &mut line[..context.width],
                &mut sites,
                &mut boundaries,
            );
            for x in 0..context.width {
                expanded[y * context.width + x] =
                    if i64::from(line[x]) <= (effect.outside * effect.outside) as i64 {
                        255
                    } else {
                        0
                    };
            }
        }
    } else {
        expanded.copy_from_slice(&alpha);
    }
    if effect.inside > 0 {
        minimum(
            &alpha,
            &mut scratch,
            context,
            effect.inside,
            false,
            &mut queue,
        );
        minimum(
            &scratch,
            &mut alpha,
            context,
            effect.inside,
            true,
            &mut queue,
        );
    }
    let gradient = match &effect.paint {
        Paint::Gradient(value) => Some(value.overlay()),
        _ => None,
    };
    output.copy_from_slice(target);
    for y in 0..region.height {
        for x in 0..region.width {
            let local = (region.y - context.y + y) * context.width + region.x - context.x + x;
            let mask = f64::from(expanded[local].saturating_sub(alpha[local])) / 255.0;
            if mask <= 0.0 {
                continue;
            }
            let (color, paint_alpha) = match &effect.paint {
                Paint::Color(color, alpha) => (*color, *alpha),
                Paint::Gradient(_) => {
                    let value = gradient.as_ref().unwrap();
                    sample_gradient(
                        value.colors,
                        value.opacities,
                        value.position(region.x + x, region.y + y, width, height),
                    )
                }
                Paint::Pattern(value) => {
                    let (color, alpha) = sample_pattern(*value, region.x + x, region.y + y);
                    (color.map(f64::from), alpha)
                }
                Paint::Missing => unreachable!(),
            };
            let alpha = (255.0 * mask * paint_alpha * effect.opacity / 100.0 + 0.5).floor();
            let pixel: &mut [u8; 4] = (&mut output
                [(y * region.width + x) * 4..(y * region.width + x + 1) * 4])
                .try_into()
                .unwrap();
            composite_pixel_values(pixel, color, alpha, effect.mode);
        }
    }
    Ok(())
}

/// # Safety
/// Use live allocator pairs; output must not overlap any input.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_stroke_region(
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
    packet_ptr: *const u8,
    packet_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
) -> u32 {
    if [source_ptr, target_ptr, packet_ptr, output_ptr.cast_const()]
        .iter()
        .any(|p| p.is_null())
    {
        return 3;
    }
    if [source_len, target_len, output_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
        || !(HEADER..=MAX_POC_BYTES).contains(&packet_len)
    {
        return 1;
    }
    let start = output_ptr as usize;
    let Some(end) = start.checked_add(output_len) else {
        return 1;
    };
    for (pointer, length) in [
        (source_ptr, source_len),
        (target_ptr, target_len),
        (packet_ptr, packet_len),
    ] {
        let input = pointer as usize;
        let Some(input_end) = input.checked_add(length) else {
            return 1;
        };
        if input < end && start < input_end {
            return 5;
        }
    }
    match apply_stroke_region(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        RasterRegion {
            x: x as usize,
            y: y as usize,
            width: width as usize,
            height: height as usize,
        },
        std::slice::from_raw_parts(target_ptr, target_len),
        std::slice::from_raw_parts(packet_ptr, packet_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
    ) {
        Ok(()) => 0,
        Err(status) => status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(outside: u32, inside: u32) -> Vec<u8> {
        let mut bytes = vec![0; HEADER];
        bytes[..4].copy_from_slice(&0x314b5453u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&outside.to_le_bytes());
        bytes[12..16].copy_from_slice(&inside.to_le_bytes());
        bytes[24..28].copy_from_slice(&[51, 102, 153, 255]);
        bytes[56..64].copy_from_slice(&100.0f64.to_le_bytes());
        bytes[64..72].copy_from_slice(&1.0f64.to_le_bytes());
        bytes[80..88].copy_from_slice(&1.0f64.to_le_bytes());
        bytes
    }
    #[test]
    fn disk_does_not_fill_square_corners() {
        let mut source = [0; 5 * 5 * 4];
        source[(2 * 5 + 2) * 4 + 3] = 255;
        let mut output = [0; 100];
        let region = RasterRegion {
            x: 0,
            y: 0,
            width: 5,
            height: 5,
        };
        apply_stroke_region(&source, 5, 5, region, &[0; 100], &packet(1, 0), &mut output).unwrap();
        assert_eq!(output[(5 + 1) * 4 + 3], 0);
        assert_eq!(output[(5 + 2) * 4 + 3], 255);
        assert_eq!(output[(2 * 5 + 2) * 4 + 3], 0);
    }
    #[test]
    fn inner_erosion_uses_zero_beyond_source_edges() {
        let mut source = [0; 36];
        for value in source.iter_mut().skip(3).step_by(4) {
            *value = 101;
        }
        let mut output = [0; 36];
        apply_stroke_region(
            &source,
            3,
            3,
            RasterRegion {
                x: 0,
                y: 0,
                width: 3,
                height: 3,
            },
            &[0; 36],
            &packet(0, 1),
            &mut output,
        )
        .unwrap();
        assert_eq!(output[3], 101);
        assert_eq!(output[19], 0);
    }
    #[test]
    fn invalid_packet_preserves_output() {
        let mut bytes = packet(1, 0);
        bytes[32] = 2;
        let mut output = [99; 4];
        assert_eq!(
            apply_stroke_region(
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
                &bytes,
                &mut output
            ),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn budget_includes_distance_lines_queue_and_checked_arithmetic() {
        let context = RasterRegion {
            x: 0,
            y: 0,
            width: 1024,
            height: 1024,
        };
        assert_eq!(
            working_bytes(4 * 1024 * 1024, 4 * 1024 * 1024, 96, context, 8, 8),
            Ok(19 * 1024 * 1024 + 24 * 1024 + 64 + 8 + 96 + 2048)
        );
        assert_eq!(working_bytes(usize::MAX, 4, 96, context, 8, 8), Err(6));
    }

    #[test]
    fn distance_overflow_is_rejected_before_output_write() {
        let source = vec![0; 46341 * 4];
        let mut output = [99; 4];
        assert_eq!(
            apply_stroke_region(
                &source,
                46341,
                1,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },
                &[0; 4],
                &packet(1, 0),
                &mut output
            ),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
}
