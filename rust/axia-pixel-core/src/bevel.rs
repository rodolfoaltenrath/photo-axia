//! Height ramp and central-difference lighting on the original source grid.
use crate::alpha_mask::{blur_in_place, budget, context_region};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::effect_math::contour_value;
use crate::pattern_overlay::{sample_pattern, validate_pattern, PatternOverlay, PatternRaster};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 160;
const METADATA_BYTES: usize = 1024;
fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
fn points(preset: u32, count: usize, bytes: &[u8]) -> Result<Vec<(f64, f64)>, u32> {
    if preset > 5 || (preset == 5 && !(2..=32).contains(&count)) || (preset != 5 && count != 0) {
        return Err(2);
    }
    let mut values = Vec::new();
    values.try_reserve_exact(count).map_err(|_| 6u32)?;
    let mut previous = 0.0;
    for point in bytes.as_chunks::<16>().0 {
        let x = double(point, 0);
        let y = double(point, 8);
        if !x.is_finite()
            || !y.is_finite()
            || !(previous..=1.0).contains(&x)
            || !(0.0..=1.0).contains(&y)
        {
            return Err(2);
        }
        values.push((x, y));
        previous = x;
    }
    Ok(values)
}

struct Bevel<'a> {
    radius: usize,
    soften: usize,
    technique: u32,
    style: u32,
    down: bool,
    contour_enabled: bool,
    gloss: u32,
    gloss_points: Vec<(f64, f64)>,
    contour: u32,
    contour_points: Vec<(f64, f64)>,
    highlight_mode: BlendMode,
    shadow_mode: BlendMode,
    highlight: [u8; 4],
    shadow: [u8; 4],
    opacity: f64,
    strength: f64,
    light: [f64; 3],
    highlight_opacity: f64,
    shadow_opacity: f64,
    contour_range: f64,
    texture: Option<PatternOverlay<'a>>,
    texture_depth: f64,
}
fn parse(packet: &[u8]) -> Result<Bevel<'_>, u32> {
    if !(HEADER..=MAX_POC_BYTES).contains(&packet.len()) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31564542 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let radius = integer(packet, 8) as usize;
    let soften = integer(packet, 12) as usize;
    let technique = integer(packet, 16);
    let style = integer(packet, 20);
    let down = integer(packet, 24);
    let contour_enabled = integer(packet, 28);
    let highlight_mode = BlendMode::try_from(integer(packet, 32)).map_err(|_| 2u32)?;
    let shadow_mode = BlendMode::try_from(integer(packet, 36)).map_err(|_| 2u32)?;
    let gloss = integer(packet, 48);
    let gloss_count = integer(packet, 52) as usize;
    let contour = integer(packet, 56);
    let contour_count = integer(packet, 60) as usize;
    let texture_width = integer(packet, 64) as usize;
    let texture_height = integer(packet, 68) as usize;
    let texture_length = integer(packet, 72) as usize;
    let texture_invert = integer(packet, 76);
    let opacity = double(packet, 80);
    let strength = double(packet, 88);
    let light = [double(packet, 96), double(packet, 104), double(packet, 112)];
    let highlight_opacity = double(packet, 120);
    let shadow_opacity = double(packet, 128);
    let contour_range = double(packet, 136);
    let texture_scale = double(packet, 144);
    let texture_depth = double(packet, 152);
    if radius == 0
        || radius > 4096
        || soften > 4096
        || radius + soften > 4096
        || technique > 2
        || style > 3
        || down > 1
        || contour_enabled > 1
        || texture_invert > 1
        || [opacity, highlight_opacity, shadow_opacity]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=100.0).contains(v))
        || !strength.is_finite()
        || !(0.04..=40.0).contains(&strength)
        || light.iter().any(|v| !v.is_finite() || v.abs() > 1.0)
        || light[2] < 0.0
        || (light[0] * light[0] + light[1] * light[1] + light[2] * light[2] - 1.0).abs() > 1e-12
        || !contour_range.is_finite()
        || !(1.0..=100.0).contains(&contour_range)
        || !texture_scale.is_finite()
        || !(0.01..=10.0).contains(&texture_scale)
        || !texture_depth.is_finite()
        || !(-10.0..=10.0).contains(&texture_depth)
    {
        return Err(2);
    }
    if gloss_count > 32 || contour_count > 32 || texture_length > MAX_POC_BYTES {
        return Err(1);
    }
    let points_end = HEADER + (gloss_count + contour_count) * 16;
    if points_end.checked_add(texture_length) != Some(packet.len()) {
        return Err(1);
    }
    let gloss_end = HEADER + gloss_count * 16;
    let gloss_points = points(gloss, gloss_count, &packet[HEADER..gloss_end])?;
    let contour_points = points(contour, contour_count, &packet[gloss_end..points_end])?;
    let texture = if texture_length == 0 {
        if texture_width != 0
            || texture_height != 0
            || texture_invert != 0
            || texture_scale != 1.0
            || texture_depth != 0.0
        {
            return Err(2);
        }
        None
    } else {
        validate_pattern(texture_length, texture_width, texture_height).map_err(|_| 2u32)?;
        Some(PatternOverlay {
            pattern: PatternRaster {
                data: &packet[points_end..],
                width: texture_width,
                height: texture_height,
            },
            cosine: 1.0,
            sine: -0.0,
            scale_factor: texture_scale,
            opacity: 100.0,
            blend_mode: BlendMode::Normal,
        })
    };
    Ok(Bevel {
        radius,
        soften,
        technique,
        style,
        down: down == 1,
        contour_enabled: contour_enabled == 1,
        gloss,
        gloss_points,
        contour,
        contour_points,
        highlight_mode,
        shadow_mode,
        highlight: packet[40..44].try_into().unwrap(),
        shadow: packet[44..48].try_into().unwrap(),
        opacity,
        strength,
        light,
        highlight_opacity,
        shadow_opacity,
        contour_range,
        texture,
        texture_depth: texture_depth * if texture_invert == 1 { -1.0 } else { 1.0 },
    })
}

fn reserve_mask(count: usize) -> Result<Vec<u8>, u32> {
    let mut mask = Vec::new();
    mask.try_reserve_exact(count).map_err(|_| 6u32)?;
    mask.resize(count, 0);
    Ok(mask)
}
pub fn apply_bevel_region(
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
    // One extra sample on each side for the central differences.
    let context = context_region(width, height, region, effect.radius + effect.soften + 1);
    let extra = target
        .len()
        .checked_add(packet.len())
        .and_then(|v| v.checked_add(METADATA_BYTES))
        .ok_or(6u32)?;
    budget(
        source.len().checked_add(extra).ok_or(6u32)?,
        output.len(),
        context,
        0,
    )?;
    let mut ramp = reserve_mask(context.width * context.height)?;
    let mut scratch = reserve_mask(ramp.len())?;
    for y in 0..context.height {
        for x in 0..context.width {
            ramp[y * context.width + x] = source[((context.y + y) * width + context.x + x) * 4 + 3];
        }
    }
    blur_in_place(
        &mut ramp,
        &mut scratch,
        context.width,
        context.height,
        effect.radius,
        effect.technique != 0,
    );
    blur_in_place(
        &mut ramp,
        &mut scratch,
        context.width,
        context.height,
        effect.soften,
        false,
    );
    if effect.technique == 1 {
        for value in &mut ramp {
            *value = (((f64::from(*value) / 255.0 - 0.5) * 2.0 + 0.5).clamp(0.0, 1.0) * 255.0 + 0.5)
                .floor() as u8;
        }
    }
    if let Some(texture) = effect.texture {
        for y in 0..context.height {
            for x in 0..context.width {
                let (color, _) = sample_pattern(texture, context.x + x, context.y + y);
                let luminance =
                    (f64::from(color[0]) + f64::from(color[1]) + f64::from(color[2])) / 3.0 / 255.0;
                let delta = (luminance - 0.5) * 2.0 * effect.texture_depth;
                let value = &mut ramp[y * context.width + x];
                *value = ((f64::from(*value) / 255.0 + delta).clamp(0.0, 1.0) * 255.0 + 0.5).floor()
                    as u8;
            }
        }
    }
    let height_at = |x: usize, y: usize| {
        f64::from(ramp[(y - context.y) * context.width + x - context.x]) / 255.0
    };
    let direction_sign = if effect.down { -1.0 } else { 1.0 };
    let style_sign = if effect.style == 3 { -1.0 } else { 1.0 };
    let highlight_color = [
        effect.highlight[0],
        effect.highlight[1],
        effect.highlight[2],
    ]
    .map(f64::from);
    let shadow_color = [effect.shadow[0], effect.shadow[1], effect.shadow[2]].map(f64::from);
    output.copy_from_slice(target);
    for y in region.y..region.y + region.height {
        for x in region.x..region.x + region.width {
            let mask = f64::from(source[(y * width + x) * 4 + 3]) / 255.0;
            let weight = match effect.style {
                0 => mask,
                1 => 1.0 - mask,
                _ => 1.0,
            };
            if weight <= 0.0 {
                continue;
            }
            let dx = (height_at((x + 1).min(width - 1), y) - height_at(x.saturating_sub(1), y))
                / 2.0
                * effect.strength
                * direction_sign
                * style_sign;
            let dy = (height_at(x, (y + 1).min(height - 1)) - height_at(x, y.saturating_sub(1)))
                / 2.0
                * effect.strength
                * direction_sign
                * style_sign;
            let nx = -dx;
            let ny = -dy;
            let length = (nx * nx + ny * ny + 1.0).sqrt();
            let dot = (nx * effect.light[0] + ny * effect.light[1] + effect.light[2]) / length;
            if dot == 0.0 {
                continue;
            }
            let intensity = contour_value(
                effect.gloss,
                &effect.gloss_points,
                dot.abs().clamp(0.0, 1.0),
            );
            let ranged = if effect.contour_enabled {
                contour_value(
                    effect.contour,
                    &effect.contour_points,
                    (intensity * 100.0 / effect.contour_range).clamp(0.0, 1.0),
                )
            } else {
                intensity
            };
            let (color, color_alpha, opacity, mode) = if dot > 0.0 {
                (
                    highlight_color,
                    effect.highlight[3],
                    effect.highlight_opacity,
                    effect.highlight_mode,
                )
            } else {
                (
                    shadow_color,
                    effect.shadow[3],
                    effect.shadow_opacity,
                    effect.shadow_mode,
                )
            };
            let alpha = (255.0 * ranged * weight * (f64::from(color_alpha) / 255.0) * opacity
                / 100.0
                * effect.opacity
                / 100.0
                + 0.5)
                .floor();
            let offset = ((y - region.y) * region.width + x - region.x) * 4;
            let pixel: &mut [u8; 4] = (&mut output[offset..offset + 4]).try_into().unwrap();
            composite_pixel_values(pixel, color, alpha, mode);
        }
    }
    Ok(())
}

/// # Safety
/// Use live allocator pairs; output must not overlap any input.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_bevel_region(
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
    match apply_bevel_region(
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
    fn packet() -> Vec<u8> {
        let mut bytes = vec![0; HEADER];
        bytes[..4].copy_from_slice(&0x31564542u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&1u32.to_le_bytes());
        bytes[40..44].copy_from_slice(&[51, 102, 153, 255]);
        for (offset, value) in [
            (80, 100.0f64),
            (88, 4.0),
            (112, 1.0),
            (120, 100.0),
            (128, 100.0),
            (136, 100.0),
            (144, 1.0),
        ] {
            bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn inner_and_outer_weights_use_original_alpha() {
        let region = RasterRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        let mut bytes = packet();
        let mut output = [0; 4];
        apply_bevel_region(&[0, 0, 0, 101], 1, 1, region, &[0; 4], &bytes, &mut output).unwrap();
        assert_eq!(output, [51, 102, 153, 101]);
        bytes[20..24].copy_from_slice(&1u32.to_le_bytes());
        apply_bevel_region(&[0, 0, 0, 101], 1, 1, region, &[0; 4], &bytes, &mut output).unwrap();
        assert_eq!(output, [51, 102, 153, 154]);
    }
    #[test]
    fn zero_dot_preserves_hidden_rgb() {
        let mut bytes = packet();
        bytes[96..104].copy_from_slice(&1.0f64.to_le_bytes());
        bytes[112..120].fill(0);
        let mut output = [0; 4];
        apply_bevel_region(
            &[0, 0, 0, 101],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            &[77, 88, 99, 0],
            &bytes,
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [77, 88, 99, 0]);
    }
    #[test]
    fn invalid_light_preserves_output() {
        let mut bytes = packet();
        bytes[112..120].copy_from_slice(&0.5f64.to_le_bytes());
        let mut output = [99; 4];
        assert_eq!(
            apply_bevel_region(
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
    fn budget_counts_both_masks_and_metadata_without_overflow() {
        let context = RasterRegion {
            x: 0,
            y: 0,
            width: 4096,
            height: 4096,
        };
        assert_eq!(
            budget(64 * 1024 * 1024 + HEADER + METADATA_BYTES, 4, context, 0),
            Err(6)
        );
        assert_eq!(budget(usize::MAX, 4, context, 0), Err(6));
        let small = RasterRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        assert!(budget(4 + 4 + HEADER + METADATA_BYTES, 4, small, 0).is_ok());
    }
}
