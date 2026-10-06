//! Transactional local styles; no document transforms or backdrop composition.
use crate::blend_if::{apply_this_layer_region, BlendIfChannel, BlendIfConfig};
use crate::color_overlay::{apply_color_overlay_region, ColorOverlay};
use crate::composite::BlendMode;
use crate::gradient_overlay::{
    apply_gradient_overlay_region, ColorStop, GradientKind, GradientOverlay, OpacityStop,
};
use crate::pattern_overlay::{
    apply_pattern_overlay_region, validate_parameters, validate_pattern, PatternOverlay,
    PatternRaster,
};
use crate::{
    apply_fill_opacity_region_fractional, validate_raster_region, RasterRegion, MAX_POC_BYTES,
};

const MAX_JOB_BYTES: usize = 96 * 1024 * 1024;
const HEADER: usize = 32;
const RECORD: usize = 96;
const MAX_EFFECTS: usize = 64;

fn check_budget(
    source: usize,
    packet: usize,
    output: usize,
    count: usize,
    temporaries: usize,
) -> Result<(), u32> {
    let total = source
        .checked_add(packet)
        .and_then(|bytes| {
            output
                .checked_mul(1 + temporaries)
                .and_then(|rasters| bytes.checked_add(rasters))
        })
        .and_then(|bytes| bytes.checked_add(count * 2048))
        .ok_or(6u32)?;
    if total > MAX_JOB_BYTES {
        return Err(6);
    }
    Ok(())
}

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
fn zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|byte| *byte == 0)
}
fn payload<'a>(
    packet: &'a [u8],
    metadata_end: usize,
    record: &[u8],
    offset: usize,
) -> Result<&'a [u8], u32> {
    let start = integer(record, offset) as usize;
    let length = integer(record, offset + 4) as usize;
    let end = start.checked_add(length).ok_or(1u32)?;
    if start < metadata_end || !start.is_multiple_of(8) || length == 0 {
        return Err(1);
    }
    packet.get(start..end).ok_or(1)
}

pub(crate) enum Effect<'a> {
    Color(ColorOverlay),
    Gradient {
        kind: GradientKind,
        colors: Vec<ColorStop>,
        opacities: Vec<OpacityStop>,
        angle: f64,
        cosine: f64,
        sine: f64,
        scale: f64,
        reverse: bool,
        opacity: f64,
        blend_mode: BlendMode,
    },
    Pattern(PatternOverlay<'a>),
}
impl Effect<'_> {
    pub(crate) fn apply(
        &self,
        source: &[u8],
        width: usize,
        height: usize,
        region: RasterRegion,
        target: &[u8],
        output: &mut [u8],
    ) -> Result<(), &'static str> {
        match self {
            Self::Color(effect) => {
                apply_color_overlay_region(source, width, height, region, target, output, *effect)
            }
            Self::Pattern(effect) => {
                apply_pattern_overlay_region(source, width, height, region, target, output, *effect)
            }
            Self::Gradient {
                kind,
                colors,
                opacities,
                angle,
                cosine,
                sine,
                scale,
                reverse,
                opacity,
                blend_mode,
            } => apply_gradient_overlay_region(
                source,
                width,
                height,
                region,
                target,
                output,
                GradientOverlay {
                    kind: *kind,
                    colors,
                    opacities,
                    angle_radians: *angle,
                    cosine: *cosine,
                    sine: *sine,
                    scale: *scale,
                    reverse: *reverse,
                    opacity: *opacity,
                    blend_mode: *blend_mode,
                },
            ),
        }
    }
}

pub(crate) fn parse_effect<'a>(
    packet: &'a [u8],
    metadata_end: usize,
    record: &[u8],
) -> Result<Effect<'a>, u32> {
    if !zero(&record[80..]) {
        return Err(2);
    }
    let blend_mode = BlendMode::try_from(integer(record, 4)).map_err(|_| 2u32)?;
    let opacity = double(record, 8);
    match integer(record, 0) {
        1 => {
            if !zero(&record[16..52]) || !zero(&record[56..80]) {
                return Err(2);
            }
            let effect = ColorOverlay {
                color: record[52..56].try_into().unwrap(),
                opacity,
                blend_mode,
            };
            effect.validate().map_err(|_| 2u32)?;
            Ok(Effect::Color(effect))
        }
        2 => {
            if !zero(&record[52..56]) || !zero(&record[76..80]) || integer(record, 48) > 1 {
                return Err(2);
            }
            let colors_data = payload(packet, metadata_end, record, 56)?;
            let opacities_data = payload(packet, metadata_end, record, 64)?;
            if !colors_data.len().is_multiple_of(16)
                || !(32..=512).contains(&colors_data.len())
                || !opacities_data.len().is_multiple_of(16)
                || !(32..=512).contains(&opacities_data.len())
            {
                return Err(2);
            }
            let mut colors = Vec::new();
            let mut opacities = Vec::new();
            colors
                .try_reserve_exact(colors_data.len() / 16)
                .map_err(|_| 6u32)?;
            opacities
                .try_reserve_exact(opacities_data.len() / 16)
                .map_err(|_| 6u32)?;
            for stop in colors_data.as_chunks::<16>().0 {
                if !zero(&stop[12..]) {
                    return Err(2);
                }
                colors.push(ColorStop {
                    position: double(stop, 0),
                    color: stop[8..12].try_into().unwrap(),
                });
            }
            for stop in opacities_data.as_chunks::<16>().0 {
                opacities.push(OpacityStop {
                    position: double(stop, 0),
                    opacity: double(stop, 8),
                });
            }
            let effect = GradientOverlay {
                kind: GradientKind::try_from(integer(record, 72)).map_err(|_| 2u32)?,
                colors: &colors,
                opacities: &opacities,
                angle_radians: double(record, 16),
                cosine: double(record, 24),
                sine: double(record, 32),
                scale: double(record, 40),
                reverse: integer(record, 48) == 1,
                opacity,
                blend_mode,
            };
            effect.validate().map_err(|_| 2u32)?;
            Ok(Effect::Gradient {
                kind: effect.kind,
                angle: effect.angle_radians,
                cosine: effect.cosine,
                sine: effect.sine,
                scale: effect.scale,
                reverse: effect.reverse,
                opacity,
                blend_mode,
                colors,
                opacities,
            })
        }
        3 => {
            if !zero(&record[16..24]) || !zero(&record[48..56]) || !zero(&record[64..72]) {
                return Err(2);
            }
            let data = payload(packet, metadata_end, record, 56)?;
            let width = integer(record, 72) as usize;
            let height = integer(record, 76) as usize;
            validate_pattern(data.len(), width, height).map_err(|_| 2u32)?;
            let cosine = double(record, 24);
            let sine = double(record, 32);
            let scale_factor = double(record, 40);
            validate_parameters(opacity, cosine, sine, scale_factor).map_err(|_| 2u32)?;
            Ok(Effect::Pattern(PatternOverlay {
                pattern: PatternRaster {
                    data,
                    width,
                    height,
                },
                opacity,
                blend_mode,
                cosine,
                sine,
                scale_factor,
            }))
        }
        _ => Err(2),
    }
}

pub fn apply_local_batch(
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
    if packet.len() < HEADER || packet.len() > MAX_POC_BYTES || !packet.len().is_multiple_of(8) {
        return Err(1);
    }
    if integer(packet, 0) != 0x31425841 || integer(packet, 4) != 1 {
        return Err(2);
    }
    let count = integer(packet, 8) as usize;
    if count > MAX_EFFECTS {
        return Err(2);
    }
    let metadata_end = HEADER + count * RECORD;
    if metadata_end > packet.len() {
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
    let temporary_count = if count != 0 || filter.is_some() { 2 } else { 1 };
    check_budget(
        source.len(),
        packet.len(),
        output.len(),
        count,
        temporary_count,
    )?;
    let mut effects = Vec::new();
    effects.try_reserve_exact(count).map_err(|_| 6u32)?;
    for record in packet[HEADER..metadata_end].as_chunks::<RECORD>().0 {
        effects.push(parse_effect(packet, metadata_end, record)?);
    }
    let mut current = Vec::new();
    let mut scratch = Vec::new();
    current.try_reserve_exact(output.len()).map_err(|_| 6u32)?;
    current.resize(output.len(), 0);
    if temporary_count == 2 {
        scratch.try_reserve_exact(output.len()).map_err(|_| 6u32)?;
        scratch.resize(output.len(), 0);
    }
    apply_fill_opacity_region_fractional(source, width, height, region, &mut current, fill)
        .map_err(|_| 2u32)?;
    for effect in effects {
        effect
            .apply(source, width, height, region, &current, &mut scratch)
            .map_err(|_| 2u32)?;
        std::mem::swap(&mut current, &mut scratch);
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
pub unsafe extern "C" fn axia_poc_local_batch_region(
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
    if [source_len, packet_len, output_len]
        .iter()
        .any(|length| *length == 0 || *length > MAX_POC_BYTES || !length.is_multiple_of(4))
    {
        return 1;
    }
    let out_start = output_ptr as usize;
    let Some(out_end) = out_start.checked_add(output_len) else {
        return 1;
    };
    for (pointer, length) in [(source_ptr, source_len), (packet_ptr, packet_len)] {
        let start = pointer as usize;
        let Some(end) = start.checked_add(length) else {
            return 1;
        };
        if start < out_end && out_start < end {
            return 5;
        }
    }
    let region = RasterRegion {
        x: x as usize,
        y: y as usize,
        width: width as usize,
        height: height as usize,
    };
    match apply_local_batch(
        std::slice::from_raw_parts(source_ptr, source_len),
        source_width as usize,
        source_height as usize,
        region,
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
    const REGION: RasterRegion = RasterRegion {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
    };
    fn color_packet() -> Vec<u8> {
        let mut packet = vec![0; HEADER + 2 * RECORD];
        packet[0..4].copy_from_slice(&0x31425841u32.to_le_bytes());
        packet[4..8].copy_from_slice(&1u32.to_le_bytes());
        packet[8..12].copy_from_slice(&2u32.to_le_bytes());
        for (index, color) in [[255, 0, 0, 255], [0, 0, 255, 255]].iter().enumerate() {
            let start = HEADER + index * RECORD;
            packet[start..start + 4].copy_from_slice(&1u32.to_le_bytes());
            packet[start + 8..start + 16].copy_from_slice(&50.0f64.to_le_bytes());
            packet[start + 52..start + 56].copy_from_slice(color);
        }
        packet
    }
    #[test]
    fn ordered_overlays_keep_original_mask_with_zero_fill() {
        let mut output = [0; 4];
        apply_local_batch(
            &[40, 60, 80, 255],
            1,
            1,
            REGION,
            &color_packet(),
            &mut output,
        )
        .unwrap();
        assert_eq!(output, [85, 0, 170, 192]);
    }
    #[test]
    fn invalid_late_effect_preserves_output() {
        let mut packet = color_packet();
        packet[HEADER + RECORD + 8..HEADER + RECORD + 16].copy_from_slice(&f64::NAN.to_le_bytes());
        let mut output = [99; 4];
        assert_eq!(
            apply_local_batch(&[40, 60, 80, 255], 1, 1, REGION, &packet, &mut output),
            Err(2)
        );
        assert_eq!(output, [99; 4]);
    }
    #[test]
    fn terminal_filter_keeps_each_alpha_rounding() {
        let mut packet = color_packet()[..HEADER].to_vec();
        packet[8..12].fill(0);
        packet[12..16].copy_from_slice(&[0, 80, 255, 255]);
        packet[16..24].copy_from_slice(&50.0f64.to_le_bytes());
        packet[24..28].copy_from_slice(&1u32.to_le_bytes());
        packet[28..32].copy_from_slice(&1u32.to_le_bytes());
        let mut output = [0; 4];
        apply_local_batch(&[40, 60, 80, 1], 1, 1, REGION, &packet, &mut output).unwrap();
        assert_eq!(output, [40, 60, 80, 1]);
    }
    #[test]
    fn budget_counts_both_scratch_buffers_and_checks_overflow() {
        assert_eq!(
            check_budget(64 * 1024 * 1024, 32, 10 * 1024 * 1024, 0, 2),
            Ok(())
        );
        assert_eq!(
            check_budget(64 * 1024 * 1024, 32, 11 * 1024 * 1024, 0, 2),
            Err(6)
        );
        assert_eq!(check_budget(usize::MAX, 32, 4, 0, 2), Err(6));
    }
}
