//! Inner/outer glow on a prepared mask and compact target.
use crate::alpha_mask::{filtered_alpha_context, AlphaMask, AlphaMaskJob};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::effect_math::{contour_value, random_at};
use crate::gradient_overlay::{
    sample_gradient, ColorStop, GradientKind, GradientOverlay, OpacityStop,
};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 96;
const MAX_PACKET: usize = HEADER + 3 * 32 * 16;
const METADATA_BYTES: usize = 2048;

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

enum Paint {
    Color([f64; 3], f64),
    Gradient {
        colors: Vec<ColorStop>,
        opacities: Vec<OpacityStop>,
        reverse: bool,
    },
}

struct Glow {
    kind: u32,
    mask: AlphaMask,
    mode: BlendMode,
    paint: Paint,
    contour: u32,
    points: Vec<(f64, f64)>,
    seed: u32,
    opacity: f64,
    noise: f64,
    range: f64,
    jitter: f64,
    choke: f64,
}

fn parse(packet: &[u8]) -> Result<Glow, u32> {
    if !(HEADER..=MAX_PACKET).contains(&packet.len()) || !packet.len().is_multiple_of(8) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31574c47 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let kind = integer(packet, 8);
    let spread = integer(packet, 12) as usize;
    let blur = integer(packet, 16) as usize;
    let precise = integer(packet, 20);
    let mode = BlendMode::try_from(integer(packet, 24)).map_err(|_| 2u32)?;
    let paint_kind = integer(packet, 28);
    let contour = integer(packet, 36);
    let count = integer(packet, 44) as usize;
    let color_count = integer(packet, 48) as usize;
    let opacity_count = integer(packet, 52) as usize;
    let opacity = double(packet, 56);
    let noise = double(packet, 64);
    let range = double(packet, 72);
    let jitter = double(packet, 80);
    let choke = double(packet, 88);
    if kind > 2
        || precise > 1
        || paint_kind > 2
        || contour > 5
        || spread > 4096
        || blur > 4096
        || spread + blur > 4096
        || [opacity, noise, jitter, choke]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=100.0).contains(v))
        || !range.is_finite()
        || !(1.0..=100.0).contains(&range)
        || (kind == 0 && choke != 0.0)
        || (kind != 0 && spread != 0)
    {
        return Err(2);
    }
    if [count, color_count, opacity_count].iter().any(|n| *n > 32)
        || packet.len() != HEADER + (count + color_count + opacity_count) * 16
    {
        return Err(1);
    }
    if (contour == 5 && !(2..=32).contains(&count))
        || (contour != 5 && count != 0)
        || (paint_kind == 0 && (color_count != 0 || opacity_count != 0))
        || (paint_kind != 0
            && (!(2..=32).contains(&color_count) || !(2..=32).contains(&opacity_count)))
    {
        return Err(2);
    }
    let mut points = Vec::new();
    points.try_reserve_exact(count).map_err(|_| 6u32)?;
    let contour_end = HEADER + count * 16;
    let mut previous = 0.0;
    for point in packet[HEADER..contour_end].as_chunks::<16>().0 {
        let x = double(point, 0);
        let y = double(point, 8);
        if !x.is_finite()
            || !y.is_finite()
            || !(previous..=1.0).contains(&x)
            || !(0.0..=1.0).contains(&y)
        {
            return Err(2);
        }
        points.push((x, y));
        previous = x;
    }
    let paint = if paint_kind == 0 {
        Paint::Color(
            [packet[32], packet[33], packet[34]].map(f64::from),
            f64::from(packet[35]) / 255.0,
        )
    } else {
        if packet[32..36].iter().any(|v| *v != 0) {
            return Err(2);
        }
        let mut colors = Vec::new();
        let mut opacities = Vec::new();
        colors.try_reserve_exact(color_count).map_err(|_| 6u32)?;
        opacities
            .try_reserve_exact(opacity_count)
            .map_err(|_| 6u32)?;
        let colors_end = contour_end + color_count * 16;
        for stop in packet[contour_end..colors_end].as_chunks::<16>().0 {
            if stop[12..].iter().any(|v| *v != 0) {
                return Err(2);
            }
            colors.push(ColorStop {
                position: double(stop, 0),
                color: stop[8..12].try_into().unwrap(),
            });
        }
        for stop in packet[colors_end..].as_chunks::<16>().0 {
            opacities.push(OpacityStop {
                position: double(stop, 0),
                opacity: double(stop, 8),
            });
        }
        GradientOverlay {
            kind: GradientKind::Linear,
            colors: &colors,
            opacities: &opacities,
            cosine: 1.0,
            sine: 0.0,
            angle_radians: 0.0,
            scale: 100.0,
            reverse: false,
            opacity: 100.0,
            blend_mode: mode,
        }
        .validate()
        .map_err(|_| 2u32)?;
        Paint::Gradient {
            colors,
            opacities,
            reverse: paint_kind == 2,
        }
    };
    Ok(Glow {
        kind,
        mask: AlphaMask {
            spread_radius: spread,
            blur_radius: blur,
            precise: precise == 1,
        },
        mode,
        paint,
        contour,
        points,
        seed: integer(packet, 40),
        opacity,
        noise,
        range,
        jitter,
        choke,
    })
}

pub(crate) fn validate_packet(packet: &[u8], inner: bool) -> Result<(), u32> {
    let effect = parse(packet)?;
    if (effect.kind != 0) != inner {
        return Err(2);
    }
    Ok(())
}

pub fn apply_glow_region(
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
    let extra = target
        .len()
        .checked_add(packet.len())
        .and_then(|v| v.checked_add(METADATA_BYTES))
        .ok_or(6u32)?;
    let (mask, context) = filtered_alpha_context(
        source,
        width,
        height,
        region,
        output.len(),
        AlphaMaskJob {
            config: effect.mask,
            offset_x: 0,
            offset_y: 0,
            extra_bytes: extra,
        },
    )?;
    output.copy_from_slice(target);
    // Inner glow with zero rounded radius is a no-op in the reference.
    if effect.kind != 0 && effect.mask.blur_radius == 0 {
        return Ok(());
    }
    for y in 0..region.height {
        for x in 0..region.width {
            let index = (region.y + y) * width + region.x + x;
            let local = (region.y - context.y + y) * context.width + region.x - context.x + x;
            let original_byte = source[index * 4 + 3];
            let original = f64::from(original_byte) / 255.0;
            let blurred = f64::from(mask[local]) / 255.0;
            let raw = if effect.kind == 0 {
                f64::from(mask[local].saturating_sub(original_byte)) / 255.0
            } else {
                if original <= 0.0 {
                    continue;
                }
                if effect.kind == 1 {
                    original * ((1.0 - blurred) * 2.0).clamp(0.0, 1.0)
                } else {
                    original * blurred
                }
            };
            if raw <= 0.0 {
                continue;
            }
            let choked = if effect.kind == 0 {
                raw
            } else {
                (raw / (1.0 - (effect.choke / 100.0).min(0.99)).max(0.01)).clamp(0.0, 1.0)
            };
            let ranged = (choked * 100.0 / effect.range).clamp(0.0, 1.0);
            let contoured = contour_value(effect.contour, &effect.points, ranged);
            let jittered = if effect.jitter > 0.0 {
                (contoured + (random_at(effect.seed, index) - 0.5) * effect.jitter / 100.0)
                    .clamp(0.0, 1.0)
            } else {
                contoured
            };
            let (color, paint_opacity) = match &effect.paint {
                Paint::Color(color, opacity) => (*color, *opacity),
                Paint::Gradient {
                    colors,
                    opacities,
                    reverse,
                } => sample_gradient(
                    colors,
                    opacities,
                    if *reverse { 1.0 - jittered } else { jittered },
                ),
            };
            let noise = if effect.noise > 0.0 {
                1.0 - random_at(effect.seed ^ 0x9e3779b9, index) * effect.noise / 100.0
            } else {
                1.0
            };
            let alpha = 255.0 * jittered * paint_opacity * effect.opacity / 100.0 * noise;
            let alpha = (if effect.kind == 0 {
                alpha
            } else {
                alpha * original
            } + 0.5)
                .floor();
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
pub unsafe extern "C" fn axia_poc_glow_region(
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
        || !(HEADER..=MAX_PACKET).contains(&packet_len)
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
    match apply_glow_region(
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
    fn packet(kind: u32, radius: u32) -> Vec<u8> {
        let mut bytes = vec![0; HEADER];
        bytes[..4].copy_from_slice(&0x31574c47u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&kind.to_le_bytes());
        bytes[16..20].copy_from_slice(&radius.to_le_bytes());
        bytes[32..36].copy_from_slice(&[51, 102, 153, 255]);
        bytes[56..64].copy_from_slice(&75.0f64.to_le_bytes());
        bytes[72..80].copy_from_slice(&100.0f64.to_le_bytes());
        bytes
    }
    #[test]
    fn outer_glow_subtracts_original_alpha_before_contour() {
        let mut bytes = packet(0, 0);
        bytes[12..16].copy_from_slice(&1u32.to_le_bytes());
        let mut output = [0; 8];
        apply_glow_region(
            &[0, 0, 0, 255, 0, 0, 0, 0],
            2,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 2,
                height: 1,
            },
            &[0; 8],
            &bytes,
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [0, 0, 0, 0, 51, 102, 153, 191]);
    }
    #[test]
    fn inner_zero_radius_preserves_hidden_target_rgb() {
        let mut output = [99; 4];
        apply_glow_region(
            &[5, 6, 7, 101],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            &[20, 30, 40, 0],
            &packet(2, 0),
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [20, 30, 40, 0]);
    }
    #[test]
    fn inner_edge_and_center_preserve_final_mask_multiplication() {
        let source = [5, 6, 7, 255];
        let region = RasterRegion {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        let mut edge = [0; 4];
        let mut center = [0; 4];
        apply_glow_region(&source, 1, 1, region, &[0; 4], &packet(1, 1), &mut edge).unwrap();
        apply_glow_region(&source, 1, 1, region, &[0; 4], &packet(2, 1), &mut center).unwrap();
        assert_eq!(edge, [51, 102, 153, 191]);
        assert_eq!(center, [51, 102, 153, 21]);
    }
    #[test]
    fn invalid_late_parameters_preserve_output() {
        let mut bytes = packet(0, 1);
        bytes[88..96].copy_from_slice(&1.0f64.to_le_bytes());
        let mut output = [99; 4];
        assert_eq!(
            apply_glow_region(
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
}
