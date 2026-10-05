//! Signed difference of mirrored blurred masks on the original alpha.
use crate::alpha_mask::{budget, context_region, filtered_alpha_context, AlphaMask, AlphaMaskJob};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::effect_math::contour_value;
use crate::{validate_raster_region, RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 64;
const MAX_PACKET: usize = HEADER + 32 * 16;

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

struct Satin {
    radius: usize,
    invert: bool,
    dx: i32,
    dy: i32,
    mode: BlendMode,
    color: [u8; 4],
    contour: u32,
    points: Vec<(f64, f64)>,
    opacity: f64,
}

fn parse(packet: &[u8]) -> Result<Satin, u32> {
    if !(HEADER..=MAX_PACKET).contains(&packet.len()) || !packet.len().is_multiple_of(8) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31544153 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let radius = integer(packet, 8) as usize;
    let invert = integer(packet, 12);
    let dx = integer(packet, 16) as i32;
    let dy = integer(packet, 20) as i32;
    let mode = BlendMode::try_from(integer(packet, 24)).map_err(|_| 2u32)?;
    let contour = integer(packet, 36);
    let count = integer(packet, 44) as usize;
    let opacity = double(packet, 48);
    if radius > 4096
        || invert > 1
        || !(-8192..=8192).contains(&dx)
        || !(-8192..=8192).contains(&dy)
        || contour > 5
        || !opacity.is_finite()
        || !(0.0..=100.0).contains(&opacity)
        || integer(packet, 28) != 0
        || integer(packet, 40) != 0
        || packet[56..64].iter().any(|v| *v != 0)
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
    Ok(Satin {
        radius,
        invert: invert == 1,
        dx,
        dy,
        mode,
        color: packet[32..36].try_into().unwrap(),
        contour,
        points,
        opacity,
    })
}

fn job_extra(
    source: usize,
    target: usize,
    packet: usize,
    output: usize,
    context: RasterRegion,
) -> Result<usize, u32> {
    // Retain the first mask while the second filter reserves its two buffers.
    let extra = context
        .width
        .checked_mul(context.height)
        .and_then(|pixels| target.checked_add(pixels))
        .and_then(|bytes| bytes.checked_add(packet))
        .and_then(|bytes| bytes.checked_add(512))
        .ok_or(6u32)?;
    budget(source.checked_add(extra).ok_or(6u32)?, output, context, 0)?;
    Ok(extra)
}

pub fn apply_satin_region(
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
    let context = context_region(width, height, region, effect.radius);
    let extra = job_extra(
        source.len(),
        target.len(),
        packet.len(),
        output.len(),
        context,
    )?;
    let filter = |dx, dy| {
        filtered_alpha_context(
            source,
            width,
            height,
            region,
            output.len(),
            AlphaMaskJob {
                config: AlphaMask {
                    spread_radius: 0,
                    blur_radius: effect.radius,
                    precise: false,
                },
                offset_x: dx,
                offset_y: dy,
                extra_bytes: extra,
            },
        )
    };
    let (positive, _) = filter(effect.dx, effect.dy)?;
    let (negative, _) = filter(-effect.dx, -effect.dy)?;
    output.copy_from_slice(target);
    let color = [effect.color[0], effect.color[1], effect.color[2]].map(f64::from);
    for y in 0..region.height {
        for x in 0..region.width {
            let index = (region.y + y) * width + region.x + x;
            let mask = f64::from(source[index * 4 + 3]) / 255.0;
            if mask <= 0.0 {
                continue;
            }
            let local = (region.y - context.y + y) * context.width + region.x - context.x + x;
            let diff = (f64::from(positive[local]) - f64::from(negative[local])) / 255.0;
            let raw = (if effect.invert { -diff } else { diff }).clamp(0.0, 1.0);
            // Raw zero still passes through the contour in the TS reference.
            let contoured = mask.min(contour_value(effect.contour, &effect.points, raw));
            let alpha = (255.0 * contoured * (f64::from(effect.color[3]) / 255.0) * effect.opacity
                / 100.0
                * mask
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
pub unsafe extern "C" fn axia_poc_satin_region(
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
    match apply_satin_region(
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
        packet[..4].copy_from_slice(&0x31544153u32.to_le_bytes());
        packet[4..8].copy_from_slice(&1u32.to_le_bytes());
        packet[16..20].copy_from_slice(&1i32.to_le_bytes());
        packet[32..36].copy_from_slice(&[51, 102, 153, 255]);
        packet[48..56].copy_from_slice(&100.0f64.to_le_bytes());
        packet
    }
    #[test]
    fn inversion_preserves_signed_difference_not_absolute_value() {
        let source = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0];
        let region = RasterRegion {
            x: 0,
            y: 0,
            width: 3,
            height: 1,
        };
        let mut forward = [0; 12];
        let mut reversed = [0; 12];
        let mut bytes = packet();
        apply_satin_region(&source, 3, 1, region, &[0; 12], &bytes, &mut forward).unwrap();
        bytes[12..16].copy_from_slice(&1u32.to_le_bytes());
        apply_satin_region(&source, 3, 1, region, &[0; 12], &bytes, &mut reversed).unwrap();
        assert_eq!(forward, [0, 0, 0, 0, 51, 102, 153, 255, 0, 0, 0, 0]);
        assert_eq!(reversed, [51, 102, 153, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    #[test]
    fn raw_zero_still_uses_contour_and_two_alpha_factors() {
        let mut bytes = packet();
        bytes[16..20].fill(0);
        bytes[36..40].copy_from_slice(&5u32.to_le_bytes());
        bytes[44..48].copy_from_slice(&2u32.to_le_bytes());
        for value in [0.0f64, 1.0, 1.0, 1.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let mut output = [0; 4];
        apply_satin_region(
            &[10, 20, 30, 101],
            1,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            &[0; 4],
            &bytes,
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [51, 102, 153, 40]);
    }
    #[test]
    fn invalid_packet_preserves_target_and_output() {
        let mut bytes = packet();
        bytes[56] = 1;
        let mut output = [99; 4];
        assert_eq!(
            apply_satin_region(
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
    fn budget_counts_retained_mask_and_checked_arithmetic() {
        let context = RasterRegion {
            x: 0,
            y: 0,
            width: 3072,
            height: 3072,
        };
        assert!(budget(
            64 * 1024 * 1024 + 4 * 1024 * 1024 + 64 + 512,
            4 * 1024 * 1024,
            context,
            0
        )
        .is_ok());
        assert_eq!(
            job_extra(
                64 * 1024 * 1024,
                4 * 1024 * 1024,
                64,
                4 * 1024 * 1024,
                context
            ),
            Err(6)
        );
        assert_eq!(
            job_extra(
                usize::MAX,
                4,
                64,
                4,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                }
            ),
            Err(6)
        );
    }
}
