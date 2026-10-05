//! External shadow on a prepared padded mask; not document composition.
use crate::alpha_mask::{filtered_alpha_context, AlphaMask, AlphaMaskJob};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 64;
const MAX_OFFSET: i32 = 8192;

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

struct Shadow {
    mask: AlphaMask,
    offset_x: i32,
    offset_y: i32,
    mode: BlendMode,
    knockout: bool,
    color: [u8; 4],
    contour: u32,
    points: Vec<(f64, f64)>,
    seed: u32,
    opacity: f64,
    noise: f64,
}

fn parse(packet: &[u8]) -> Result<Shadow, u32> {
    if packet.len() < HEADER || packet.len() > HEADER + 32 * 16 || !packet.len().is_multiple_of(8) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31444853 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let spread = integer(packet, 8) as usize;
    let blur = integer(packet, 12) as usize;
    let offset_x = integer(packet, 16) as i32;
    let offset_y = integer(packet, 20) as i32;
    let mode = BlendMode::try_from(integer(packet, 24)).map_err(|_| 2u32)?;
    let knockout = integer(packet, 28);
    let contour = integer(packet, 36);
    let count = integer(packet, 44) as usize;
    let opacity = double(packet, 48);
    let noise = double(packet, 56);
    if spread > 4096
        || blur > 4096
        || spread + blur > 4096
        || !(-MAX_OFFSET..=MAX_OFFSET).contains(&offset_x)
        || !(-MAX_OFFSET..=MAX_OFFSET).contains(&offset_y)
        || knockout > 1
        || contour > 5
        || !opacity.is_finite()
        || !(0.0..=100.0).contains(&opacity)
        || !noise.is_finite()
        || !(0.0..=100.0).contains(&noise)
    {
        return Err(2);
    }
    if count > 32 || packet.len() != HEADER + count * 16 {
        return Err(1);
    }
    if (contour == 5 && !(2..=32).contains(&count)) || (contour != 5 && count != 0) {
        return Err(2);
    }
    let mut points = Vec::new();
    points.try_reserve_exact(count).map_err(|_| 6u32)?;
    let mut previous = 0.0;
    for point in packet[HEADER..].as_chunks::<16>().0 {
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
    Ok(Shadow {
        mask: AlphaMask {
            spread_radius: spread,
            blur_radius: blur,
            precise: false,
        },
        offset_x,
        offset_y,
        mode,
        knockout: knockout == 1,
        color: packet[32..36].try_into().unwrap(),
        contour,
        points,
        seed: integer(packet, 40),
        opacity,
        noise,
    })
}

fn contour_value(effect: &Shadow, value: f64) -> f64 {
    let x = value.clamp(0.0, 1.0);
    match effect.contour {
        1 => (1.0 - (x * 2.0 - 1.0).abs()).clamp(0.0, 1.0),
        2 => (x * 2.0 - 1.0).abs().clamp(0.0, 1.0),
        3 => x * x * (3.0 - 2.0 * x),
        4 => (x * std::f64::consts::PI).sin().clamp(0.0, 1.0),
        5 => {
            // Preserve TS's first-point result after the last custom point too.
            match effect.points.iter().position(|point| point.0 >= x) {
                None | Some(0) => effect.points[0].1,
                Some(right) => {
                    let (before_x, before_y) = effect.points[right - 1];
                    let (after_x, after_y) = effect.points[right];
                    let span = after_x - before_x;
                    if span <= 0.0 {
                        after_y
                    } else {
                        (before_y + (after_y - before_y) * ((x - before_x) / span)).clamp(0.0, 1.0)
                    }
                }
            }
        }
        _ => x,
    }
}

fn random_at(seed: u32, index: usize) -> f64 {
    let mut value = seed ^ (index as u32).wrapping_add(1).wrapping_mul(0x45d9f3b);
    value ^= value >> 16;
    value = value.wrapping_mul(0x45d9f3b);
    // JS's final ^= produces a signed int32, including negative noise values.
    f64::from((value ^ (value >> 16)) as i32) / 4294967295.0
}

pub fn apply_drop_shadow_region(
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
        .and_then(|bytes| bytes.checked_add(512))
        .ok_or(6u32)?;
    let (mask, context) = filtered_alpha_context(
        source,
        width,
        height,
        region,
        output.len(),
        AlphaMaskJob {
            config: effect.mask,
            offset_x: effect.offset_x,
            offset_y: effect.offset_y,
            extra_bytes: extra,
        },
    )?;
    output.copy_from_slice(target);
    let color = [effect.color[0], effect.color[1], effect.color[2]].map(f64::from);
    for y in 0..region.height {
        for x in 0..region.width {
            let index = (region.y + y) * width + region.x + x;
            let local = (region.y - context.y + y) * context.width + region.x - context.x + x;
            let mut shadow = f64::from(mask[local]) / 255.0;
            if effect.knockout {
                shadow = (shadow - f64::from(source[index * 4 + 3]) / 255.0).max(0.0);
            }
            if shadow <= 0.0 {
                continue;
            }
            let contoured = contour_value(&effect, shadow);
            let noise = if effect.noise > 0.0 {
                1.0 - random_at(effect.seed ^ 0x9e3779b9, index) * effect.noise / 100.0
            } else {
                1.0
            };
            let alpha = (255.0 * contoured * (f64::from(effect.color[3]) / 255.0) * effect.opacity
                / 100.0
                * noise
                + 0.5)
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
pub unsafe extern "C" fn axia_poc_drop_shadow_region(
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
        .any(|pointer| pointer.is_null())
    {
        return 3;
    }
    if [source_len, target_len, output_len]
        .iter()
        .any(|length| *length == 0 || *length > MAX_POC_BYTES || !length.is_multiple_of(4))
        || !(HEADER..=HEADER + 32 * 16).contains(&packet_len)
    {
        return 1;
    }
    let out_start = output_ptr as usize;
    let Some(out_end) = out_start.checked_add(output_len) else {
        return 1;
    };
    for (pointer, length) in [
        (source_ptr, source_len),
        (target_ptr, target_len),
        (packet_ptr, packet_len),
    ] {
        let start = pointer as usize;
        let Some(end) = start.checked_add(length) else {
            return 1;
        };
        if start < out_end && out_start < end {
            return 5;
        }
    }
    match apply_drop_shadow_region(
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
        let mut packet = vec![0; HEADER];
        packet[..4].copy_from_slice(&0x31444853u32.to_le_bytes());
        packet[4..8].copy_from_slice(&1u32.to_le_bytes());
        packet[32..36].copy_from_slice(&[51, 102, 153, 255]);
        packet[48..56].copy_from_slice(&75.0f64.to_le_bytes());
        packet
    }
    #[test]
    fn shadow_composites_rounded_alpha() {
        let mut output = [0; 4];
        apply_drop_shadow_region(
            &[5, 6, 7, 101],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            &[0; 4],
            &packet(),
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [51, 102, 153, 76]);
    }
    #[test]
    fn shifted_mask_reads_outside_tile_before_blur() {
        let mut packet = packet();
        packet[16..20].copy_from_slice(&1i32.to_le_bytes());
        let mut output = [0; 4];
        apply_drop_shadow_region(
            &[0, 0, 0, 255, 0, 0, 0, 0],
            2,
            1,
            RasterRegion {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
            },
            &[0; 4],
            &packet,
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [51, 102, 153, 191]);
    }
    #[test]
    fn invalid_packet_preserves_output() {
        let mut packet = packet();
        packet[56..64].copy_from_slice(&f64::NAN.to_le_bytes());
        let mut output = [99; 4];
        assert_eq!(
            apply_drop_shadow_region(
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
                &packet,
                &mut output
            ),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn noise_is_signed_and_wrapping() {
        assert!(random_at(0x811c9dc5 ^ 0x9e3779b9, 2) >= -0.5);
        let values: Vec<_> = (0..256)
            .map(|index| random_at(0x811c9dc5 ^ 0x9e3779b9, index))
            .collect();
        assert!(values.iter().any(|value| *value < 0.0));
        assert!(values
            .iter()
            .all(|value| (-0.500001..=0.500001).contains(value)));
    }
}
