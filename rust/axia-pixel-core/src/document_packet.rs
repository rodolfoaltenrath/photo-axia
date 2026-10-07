//! DCP1/DCP2 contain relative offsets only; no pointers in descriptors.

use crate::composite::BlendMode;
use crate::document_composite::{
    compose_document_region, DocumentCompositeError, DocumentCompositeJob, DocumentRasterLayer,
    LAYER_METADATA_BYTES, MAX_JOB_BYTES, MAX_LAYERS,
};
use crate::document_transform::{DocumentAffine, DocumentOutputGrid};
use crate::{RasterRegion, MAX_POC_BYTES};

const HEADER: usize = 48;
const RECORD: usize = 40;

fn integer(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn double(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

pub(crate) struct DecodedDocument<'a> {
    document_width: u32,
    document_height: u32,
    region: RasterRegion,
    resolution_scale: f64,
    output_grid: Option<DocumentOutputGrid>,
    pub(crate) layers: Vec<DocumentRasterLayer<'a>>,
}

impl DecodedDocument<'_> {
    pub(crate) fn job(&self) -> DocumentCompositeJob<'_> {
        DocumentCompositeJob {
            document_width: self.document_width,
            document_height: self.document_height,
            region: self.region,
            resolution_scale: self.resolution_scale,
            output_grid: self.output_grid,
            layers_bottom_to_top: &self.layers,
        }
    }
}

pub(crate) fn decode_document_packet(
    packet: &[u8],
    output_len: usize,
) -> Result<DecodedDocument<'_>, u32> {
    if packet.len() < HEADER
        || packet.len() > MAX_POC_BYTES
        || !packet.len().is_multiple_of(4)
        || output_len == 0
        || output_len > MAX_POC_BYTES
        || !output_len.is_multiple_of(4)
    {
        return Err(1);
    }
    let (header, record_bytes, transformed) =
        match (&packet[..4], integer(packet, 4), integer(packet, 8)) {
            (b"DCP1", 1, 48) => (HEADER, RECORD, false),
            (b"DCP2", 2, 80) if packet.len() >= 80 && packet[72..80].iter().all(|v| *v == 0) => {
                (80, 80, true)
            }
            _ => return Err(2),
        };
    let count = integer(packet, 12) as usize;
    if count > MAX_LAYERS {
        return Err(2);
    }
    let mut cursor = header + count * record_bytes;
    if cursor > packet.len() {
        return Err(2);
    }
    let budget = packet
        .len()
        .checked_add(output_len)
        .and_then(|n| n.checked_add(count * LAYER_METADATA_BYTES))
        .ok_or(6u32)?;
    if budget > MAX_JOB_BYTES {
        return Err(6);
    }
    let mut layers = Vec::new();
    layers.try_reserve_exact(count).map_err(|_| 6u32)?;
    for index in 0..count {
        let record = header + index * record_bytes;
        let offset = integer(packet, record) as usize;
        let len = integer(packet, record + 4) as usize;
        let end = offset.checked_add(len).ok_or(2u32)?;
        if offset != cursor || len == 0 || !len.is_multiple_of(4) || end > packet.len() {
            return Err(2);
        }
        let visible = match integer(packet, record + if transformed { 16 } else { 24 }) {
            0 => false,
            1 => true,
            _ => return Err(2),
        };
        layers.push(DocumentRasterLayer {
            rgba: &packet[offset..end],
            width: integer(packet, record + 8) as usize,
            height: integer(packet, record + 12) as usize,
            x: if transformed {
                0
            } else {
                integer(packet, record + 16) as i32
            },
            y: if transformed {
                0
            } else {
                integer(packet, record + 20) as i32
            },
            visible,
            opacity: double(packet, record + if transformed { 24 } else { 32 }),
            blend_mode: BlendMode::try_from(integer(
                packet,
                record + if transformed { 20 } else { 28 },
            ))
            .map_err(|_| 2u32)?,
            transform: transformed.then(|| {
                DocumentAffine(std::array::from_fn(|index| {
                    double(packet, record + 32 + index * 8)
                }))
            }),
        });
        cursor = end;
    }
    if cursor != packet.len() {
        return Err(2);
    }
    Ok(DecodedDocument {
        document_width: integer(packet, 16),
        document_height: integer(packet, 20),
        region: RasterRegion {
            x: integer(packet, 24) as usize,
            y: integer(packet, 28) as usize,
            width: integer(packet, 32) as usize,
            height: integer(packet, 36) as usize,
        },
        resolution_scale: if transformed { 1.0 } else { double(packet, 40) },
        output_grid: transformed.then(|| DocumentOutputGrid {
            scale_x: double(packet, 40),
            scale_y: double(packet, 48),
            origin_x: double(packet, 56),
            origin_y: double(packet, 64),
        }),
        layers,
    })
}

pub fn compose_document_packet(packet: &[u8], output: &mut [u8]) -> Result<(), u32> {
    let decoded = decode_document_packet(packet, output.len())?;
    compose_document_region(decoded.job(), output).map_err(|error| match error {
        DocumentCompositeError::MemoryBudget => 6,
        DocumentCompositeError::WorkBudget => 7,
        _ => 2,
    })
}

#[no_mangle]
pub extern "C" fn axia_poc_document_packet_version() -> u32 {
    2
}

/// # Safety
/// Use live allocator pairs. Output must not overlap the packet.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_document_region(
    packet_ptr: *const u8,
    packet_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
) -> u32 {
    if packet_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [packet_len, output_len]
        .iter()
        .any(|len| *len == 0 || *len > MAX_POC_BYTES || !len.is_multiple_of(4))
    {
        return 1;
    }
    let start = packet_ptr as usize;
    let out_start = output_ptr as usize;
    let Some(end) = start.checked_add(packet_len) else {
        return 1;
    };
    let Some(out_end) = out_start.checked_add(output_len) else {
        return 1;
    };
    if start < out_end && out_start < end {
        return 5;
    }
    match compose_document_packet(
        std::slice::from_raw_parts(packet_ptr, packet_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
    ) {
        Ok(()) => 0,
        Err(code) => code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(packet: &mut [u8], offset: usize, value: u32) {
        packet[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn packet(count: usize) -> Vec<u8> {
        let mut bytes = vec![0; HEADER + count * (RECORD + 4)];
        bytes[..4].copy_from_slice(b"DCP1");
        for (offset, value) in [
            (4, 1),
            (8, 48),
            (12, count as u32),
            (16, 1),
            (20, 1),
            (32, 1),
            (36, 1),
        ] {
            set(&mut bytes, offset, value);
        }
        bytes[40..48].copy_from_slice(&1.0f64.to_le_bytes());
        for index in 0..count {
            let record = HEADER + index * RECORD;
            let offset = HEADER + count * RECORD + index * 4;
            for (position, value) in [(0, offset as u32), (4, 4), (8, 1), (12, 1), (24, 1)] {
                set(&mut bytes, record + position, value);
            }
            bytes[record + 32..record + 40].copy_from_slice(&100.0f64.to_le_bytes());
            bytes[offset..offset + 4].copy_from_slice(&[40, 80, 120, 255]);
        }
        bytes
    }

    #[test]
    fn valid_packet_and_empty_stack_render() {
        let mut output = [99; 4];
        compose_document_packet(&packet(1), &mut output).unwrap();
        assert_eq!(output, [40, 80, 120, 255]);
        compose_document_packet(&packet(0), &mut output).unwrap();
        assert_eq!(output, [0; 4]);
    }

    #[test]
    fn signed_origin_and_fractional_opacity_reach_the_kernel() {
        let mut bytes = packet(1);
        bytes[80..88].copy_from_slice(&50.0f64.to_le_bytes());
        let mut output = [99; 4];
        compose_document_packet(&bytes, &mut output).unwrap();
        assert_eq!(output, [40, 80, 120, 128]);
        set(&mut bytes, 64, (-1i32) as u32);
        compose_document_packet(&bytes, &mut output).unwrap();
        assert_eq!(output, [0; 4]);
    }

    #[test]
    fn malformed_header_records_and_offsets_preserve_output() {
        for (offset, value) in [
            (0, 0),
            (4, 2),
            (8, 44),
            (12, 1025),
            (16, 0),
            (24, u32::MAX),
            (48, 0),
            (48, u32::MAX),
            (52, 0),
            (52, u32::MAX),
            (56, 2),
            (72, 2),
            (76, 6),
        ] {
            let mut bytes = packet(1);
            set(&mut bytes, offset, value);
            let mut output = [99; 4];
            assert!(compose_document_packet(&bytes, &mut output).is_err());
            assert_eq!(output, [99; 4]);
        }
        let mut bytes = packet(1);
        bytes.extend_from_slice(&[0; 4]);
        let mut output = [99; 4];
        assert_eq!(compose_document_packet(&bytes, &mut output), Err(2));
        assert_eq!(output, [99; 4]);
    }

    #[test]
    fn invalid_later_record_is_rejected_before_render() {
        let mut bytes = packet(2);
        set(&mut bytes, HEADER + RECORD + 28, 6);
        let mut output = [99; 4];
        assert_eq!(compose_document_packet(&bytes, &mut output), Err(2));
        assert_eq!(output, [99; 4]);
    }

    #[test]
    fn truncated_packet_and_nonfinite_values_preserve_output() {
        for length in [0, 4, 44, 48, 88, 91] {
            let bytes = packet(1);
            let mut output = [99; 4];
            assert!(compose_document_packet(&bytes[..length], &mut output).is_err());
            assert_eq!(output, [99; 4]);
        }
        for offset in [40, 80] {
            let mut bytes = packet(1);
            bytes[offset..offset + 8].copy_from_slice(&f64::NAN.to_le_bytes());
            let mut output = [99; 4];
            assert_eq!(compose_document_packet(&bytes, &mut output), Err(2));
            assert_eq!(output, [99; 4]);
        }
    }

    fn affine_packet() -> Vec<u8> {
        let mut bytes = vec![0; 164];
        bytes[..4].copy_from_slice(b"DCP2");
        for (offset, value) in [
            (4, 2),
            (8, 80),
            (12, 1),
            (16, 2),
            (20, 1),
            (32, 2),
            (36, 1),
            (80, 160),
            (84, 4),
            (88, 1),
            (92, 1),
            (96, 1),
        ] {
            set(&mut bytes, offset, value);
        }
        for (offset, value) in [
            (40, 1.0f64),
            (48, 1.0),
            (104, 100.0),
            (112, 1.0),
            (136, 1.0),
            (144, 0.25),
        ] {
            bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        bytes[160..164].copy_from_slice(&[40, 80, 120, 255]);
        bytes
    }

    #[test]
    fn dcp2_supports_fractional_geometry_and_reports_version() {
        let mut output = [99; 8];
        compose_document_packet(&affine_packet(), &mut output).unwrap();
        assert_eq!(output, [40, 80, 120, 191, 40, 80, 120, 64]);
        assert_eq!(axia_poc_document_packet_version(), 2);
    }

    #[test]
    fn dcp2_reserved_bytes_and_invalid_transform_preserve_output() {
        for offset in [40, 48, 112, 136] {
            let mut bytes = affine_packet();
            bytes[offset..offset + 8].fill(0);
            let mut output = [99; 8];
            assert_eq!(compose_document_packet(&bytes, &mut output), Err(2));
            assert_eq!(output, [99; 8]);
        }
        let mut bytes = affine_packet();
        bytes[72] = 1;
        let mut output = [99; 8];
        assert_eq!(compose_document_packet(&bytes, &mut output), Err(2));
        assert_eq!(output, [99; 8]);
    }
}
