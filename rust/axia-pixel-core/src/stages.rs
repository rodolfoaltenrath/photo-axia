//! Transactional layer styles on a prepared source grid, not a document stack.
use crate::alpha_mask::context_region;
use crate::batch::{parse_effect, Effect};
use crate::blend_if::{apply_this_layer_region, BlendIfChannel, BlendIfConfig};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::{
    bevel, drop_shadow, glow, satin, stroke, validate_raster_region, RasterRegion, MAX_POC_BYTES,
};

const HEADER: usize = 32;
const RECORD: usize = 16;
const MAX_EFFECTS: usize = 64;
const MAX_JOB_BYTES: usize = 96 * 1024 * 1024;
fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
fn zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|v| *v == 0)
}

struct Pass<'a> {
    kind: u32,
    stage: u32,
    packet: &'a [u8],
    overlay: Option<Effect<'a>>,
}
fn filter_bytes(
    kind: u32,
    packet: &[u8],
    width: usize,
    height: usize,
    region: RasterRegion,
) -> Result<usize, u32> {
    let (halo, masks, spread, outside, inside) = match kind {
        1 | 3 => {
            let spread = integer(packet, 8) as usize;
            (spread + integer(packet, 12) as usize, 2, spread, 0, 0)
        }
        2 | 4 => {
            let spread = integer(packet, 12) as usize;
            (spread + integer(packet, 16) as usize, 2, spread, 0, 0)
        }
        5 => (integer(packet, 8) as usize, 3, 0, 0, 0),
        6 => return Ok(0),
        7 => (
            integer(packet, 8) as usize + integer(packet, 12) as usize + 1,
            2,
            0,
            0,
            0,
        ),
        8 => {
            if integer(packet, 16) == 3 {
                return Ok(0);
            }
            let outside = integer(packet, 8) as usize;
            let inside = integer(packet, 12) as usize;
            if outside > 0
                && width
                    .checked_mul(width)
                    .and_then(|n| n.checked_add(height.checked_mul(height)?))
                    .and_then(|n| n.checked_add(1))
                    .is_none_or(|n| n > i32::MAX as usize)
            {
                return Err(2);
            }
            (outside.max(inside), 3, 0, outside, inside)
        }
        _ => return Err(2),
    };
    let context = context_region(width, height, region, halo);
    let pixels = context.width.checked_mul(context.height).ok_or(6u32)?;
    let axis = context.width.max(context.height);
    let mut bytes = pixels.checked_mul(masks).ok_or(6u32)?;
    if spread > 0 {
        bytes = bytes
            .checked_add(axis.checked_mul(4).ok_or(6u32)?)
            .ok_or(6u32)?;
    }
    if outside > 0 {
        bytes = bytes
            .checked_add(pixels.checked_mul(4).ok_or(6u32)?)
            .and_then(|n| n.checked_add(axis.checked_mul(20)?))
            .and_then(|n| n.checked_add(8))
            .ok_or(6u32)?;
    }
    if inside > 0 {
        bytes = bytes
            .checked_add(
                axis.checked_add(inside * 2)
                    .and_then(|n| n.checked_mul(4))
                    .ok_or(6u32)?,
            )
            .ok_or(6u32)?;
    }
    Ok(bytes)
}
fn check_budget(
    source: usize,
    packet: usize,
    tile: usize,
    count: usize,
    filters: usize,
) -> Result<(), u32> {
    let total = source
        .checked_add(packet)
        .and_then(|n| n.checked_add(tile.checked_mul(3)?))
        .and_then(|n| n.checked_add(count.checked_mul(2048)?))
        .and_then(|n| n.checked_add(filters))
        .ok_or(6u32)?;
    if total > MAX_JOB_BYTES {
        return Err(6);
    }
    Ok(())
}
fn parse_pass<'a>(kind: u32, stage: u32, packet: &'a [u8]) -> Result<Pass<'a>, u32> {
    let expected = match kind {
        1 | 2 => 0,
        3..=5 => 2,
        6 => 3,
        7 | 8 => 4,
        _ => return Err(2),
    };
    if stage != expected {
        return Err(2);
    }
    let overlay = match kind {
        1 | 3 => {
            drop_shadow::validate_packet(packet, kind == 3)?;
            None
        }
        2 | 4 => {
            glow::validate_packet(packet, kind == 4)?;
            None
        }
        5 => {
            satin::validate_packet(packet)?;
            None
        }
        7 => {
            bevel::validate_packet(packet)?;
            None
        }
        8 => {
            stroke::validate_packet(packet)?;
            None
        }
        6 => {
            if packet.len() < 128 || !packet.len().is_multiple_of(8) {
                return Err(1);
            }
            if integer(packet, 0) != 0x31425841
                || integer(packet, 4) != 1
                || integer(packet, 8) != 1
                || !zero(&packet[12..16])
                || double(packet, 16) != 0.0
                || !zero(&packet[24..32])
            {
                return Err(2);
            }
            Some(parse_effect(packet, 128, &packet[32..128])?)
        }
        _ => return Err(2),
    };
    Ok(Pass {
        kind,
        stage,
        packet,
        overlay,
    })
}
impl Pass<'_> {
    fn apply(
        &self,
        source: &[u8],
        width: usize,
        height: usize,
        region: RasterRegion,
        target: &[u8],
        output: &mut [u8],
    ) -> Result<(), u32> {
        match self.kind {
            1 => drop_shadow::apply_drop_shadow_region(
                source,
                width,
                height,
                region,
                target,
                self.packet,
                output,
            ),
            2 | 4 => {
                glow::apply_glow_region(source, width, height, region, target, self.packet, output)
            }
            3 => drop_shadow::apply_inner_shadow_region(
                source,
                width,
                height,
                region,
                target,
                self.packet,
                output,
            ),
            5 => satin::apply_satin_region(
                source,
                width,
                height,
                region,
                target,
                self.packet,
                output,
            ),
            6 => self
                .overlay
                .as_ref()
                .ok_or(2u32)?
                .apply(source, width, height, region, target, output)
                .map_err(|_| 2u32),
            7 => bevel::apply_bevel_region(
                source,
                width,
                height,
                region,
                target,
                self.packet,
                output,
            ),
            8 => stroke::apply_stroke_region(
                source,
                width,
                height,
                region,
                target,
                self.packet,
                output,
            ),
            _ => Err(2),
        }
    }
}
fn composite_content(
    source: &[u8],
    width: usize,
    region: RasterRegion,
    target: &mut [u8],
    fill: f64,
) {
    let opacity = fill / 100.0;
    for y in 0..region.height {
        for x in 0..region.width {
            let from = ((region.y + y) * width + region.x + x) * 4;
            let to = (y * region.width + x) * 4;
            let alpha = (f64::from(source[from + 3]) * opacity + 0.5).floor();
            let pixel: &mut [u8; 4] = (&mut target[to..to + 4]).try_into().unwrap();
            composite_pixel_values(
                pixel,
                [source[from], source[from + 1], source[from + 2]].map(f64::from),
                alpha,
                BlendMode::Normal,
            );
        }
    }
}
pub fn apply_style_stages(
    source: &[u8],
    width: usize,
    height: usize,
    region: RasterRegion,
    packet: &[u8],
    output: &mut [u8],
) -> Result<(), u32> {
    if source.len() > MAX_POC_BYTES || output.len() > MAX_POC_BYTES {
        return Err(1);
    }
    validate_raster_region(source.len(), width, height, region, output.len()).map_err(|_| 1u32)?;
    if !(HEADER..=MAX_POC_BYTES).contains(&packet.len()) || !packet.len().is_multiple_of(8) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31475453 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let count = integer(packet, 8) as usize;
    if count > MAX_EFFECTS {
        return Err(2);
    }
    let end = HEADER + count * RECORD;
    if end > packet.len() {
        return Err(1);
    }
    let fill = double(packet, 16);
    if !fill.is_finite() || !(0.0..=100.0).contains(&fill) {
        return Err(2);
    }
    let filter = match integer(packet, 24) {
        0 => {
            if !zero(&packet[12..16]) || integer(packet, 28) != 0 {
                return Err(2);
            }
            None
        }
        1 => {
            let config = BlendIfConfig {
                channel: BlendIfChannel::try_from(integer(packet, 28)).map_err(|_| 2u32)?,
                shadows: [packet[12], packet[13]],
                highlights: [packet[14], packet[15]],
            };
            config.validate().map_err(|_| 2u32)?;
            Some(config)
        }
        _ => return Err(2),
    };
    check_budget(source.len(), packet.len(), output.len(), count, 0)?;
    let mut passes = Vec::new();
    passes.try_reserve_exact(count).map_err(|_| 6u32)?;
    let mut offset = end;
    let mut previous = 0;
    let mut peak_filters = 0;
    for record in packet[HEADER..end].as_chunks::<RECORD>().0 {
        let start = integer(record, 8) as usize;
        let length = integer(record, 12) as usize;
        if start != offset || length == 0 {
            return Err(1);
        }
        let next = start.checked_add(length).ok_or(1u32)?;
        let bytes = packet.get(start..next).ok_or(1u32)?;
        let pass = parse_pass(integer(record, 0), integer(record, 4), bytes)?;
        if pass.stage < previous {
            return Err(2);
        }
        previous = pass.stage;
        peak_filters = peak_filters.max(filter_bytes(pass.kind, bytes, width, height, region)?);
        offset = next.checked_add(7).ok_or(1u32)? / 8 * 8;
        if !zero(packet.get(next..offset).ok_or(1u32)?) {
            return Err(2);
        }
        passes.push(pass);
    }
    if offset != packet.len() {
        return Err(1);
    }
    check_budget(
        source.len(),
        packet.len(),
        output.len(),
        count,
        peak_filters,
    )?;
    let mut current = Vec::new();
    let mut scratch = Vec::new();
    current.try_reserve_exact(output.len()).map_err(|_| 6u32)?;
    scratch.try_reserve_exact(output.len()).map_err(|_| 6u32)?;
    current.resize(output.len(), 0);
    scratch.resize(output.len(), 0);
    let mut has_content = false;
    for pass in passes {
        if !has_content && pass.stage > 0 {
            composite_content(source, width, region, &mut current, fill);
            has_content = true;
        }
        pass.apply(source, width, height, region, &current, &mut scratch)?;
        std::mem::swap(&mut current, &mut scratch);
    }
    if !has_content {
        composite_content(source, width, region, &mut current, fill);
    }
    if let Some(config) = filter {
        apply_this_layer_region(
            &current,
            region.width,
            region.height,
            RasterRegion {
                x: 0,
                y: 0,
                width: region.width,
                height: region.height,
            },
            &mut scratch,
            config,
        )
        .map_err(|_| 2u32)?;
        std::mem::swap(&mut current, &mut scratch);
    }
    output.copy_from_slice(&current);
    Ok(())
}

/// # Safety
/// Use live allocator pairs; output must not overlap source or packet.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_style_stages_region(
    source_ptr: *const u8,
    source_len: usize,
    source_width: u32,
    source_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    packet_ptr: *const u8,
    packet_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
) -> u32 {
    if source_ptr.is_null() || packet_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [source_len, output_len]
        .iter()
        .any(|n| *n == 0 || *n > MAX_POC_BYTES || !n.is_multiple_of(4))
        || !(HEADER..=MAX_POC_BYTES).contains(&packet_len)
    {
        return 1;
    }
    let start = output_ptr as usize;
    let Some(end) = start.checked_add(output_len) else {
        return 1;
    };
    for (pointer, length) in [(source_ptr, source_len), (packet_ptr, packet_len)] {
        let input = pointer as usize;
        let Some(input_end) = input.checked_add(length) else {
            return 1;
        };
        if input < end && start < input_end {
            return 5;
        }
    }
    match apply_style_stages(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        RasterRegion {
            x: x as usize,
            y: y as usize,
            width: width as usize,
            height: height as usize,
        },
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
    fn packet(fill: f64) -> Vec<u8> {
        let mut bytes = vec![0; HEADER];
        bytes[..4].copy_from_slice(&0x31475453u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[16..24].copy_from_slice(&fill.to_le_bytes());
        bytes
    }
    #[test]
    fn content_rounds_fill_once_and_clears_hidden_rgb() {
        let mut output = [99; 8];
        apply_style_stages(
            &[20, 40, 60, 101, 77, 88, 99, 0],
            2,
            1,
            RasterRegion {
                x: 0,
                y: 0,
                width: 2,
                height: 1,
            },
            &packet(73.5),
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [20, 40, 60, 74, 0, 0, 0, 0]);
    }
    #[test]
    fn invalid_fill_does_not_publish_partial_pixels() {
        let mut output = [99; 4];
        assert_eq!(
            apply_style_stages(
                &[0; 4],
                1,
                1,
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1
                },
                &packet(f64::NAN),
                &mut output
            ),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn budget_counts_three_rasters_and_peak_not_sum() {
        assert!(check_budget(16 * 1024 * 1024, 1024, 4 * 1024 * 1024, 64, 8 * 1024 * 1024).is_ok());
        assert_eq!(
            check_budget(64 * 1024 * 1024, 1024, 16 * 1024 * 1024, 1, 0),
            Err(6)
        );
        assert_eq!(check_budget(usize::MAX, 32, 4, 0, 0), Err(6));
    }
}
