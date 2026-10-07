//! SDP1 prepares an owned DCP packet; subsequent tiles use the existing compositor.

use crate::document_composite::DocumentCompositeError;
use crate::document_packet::decode_document_packet;
use crate::document_styles::{prepare_styled_document_reserved, StyledDocumentError};
use crate::MAX_POC_BYTES;

fn integer(bytes: &[u8], offset: usize) -> usize {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize
}

pub fn prepare_document_style_packet(
    packet: &[u8],
    output: &mut [u8],
    resident_extra: usize,
) -> Result<(), u32> {
    if !(32..=MAX_POC_BYTES).contains(&packet.len()) || !packet.len().is_multiple_of(4) {
        return Err(1);
    }
    if &packet[..4] != b"SDP1"
        || integer(packet, 4) != 1
        || integer(packet, 8) != 32
        || packet[24..32].iter().any(|v| *v != 0)
    {
        return Err(2);
    }
    let count = integer(packet, 12);
    if count > 1024 {
        return Err(2);
    }
    let start = 32 + count * 8;
    let document_len = integer(packet, 20);
    let end = start.checked_add(document_len).ok_or(1u32)?;
    if integer(packet, 16) != start || end > packet.len() || output.len() != document_len {
        return Err(1);
    }
    let document = &packet[start..end];
    let decoded = decode_document_packet(document, output.len())?;
    if decoded.layers.len() != count {
        return Err(2);
    }
    let mut cursor = end;
    let mut styles = Vec::new();
    styles.try_reserve_exact(count).map_err(|_| 6u32)?;
    let mut source_bytes = 0usize;
    let mut style_bytes = 0usize;
    for (index, layer) in decoded.layers.iter().enumerate() {
        source_bytes = source_bytes.checked_add(layer.rgba.len()).ok_or(6u32)?;
        let record = 32 + index * 8;
        let offset = integer(packet, record);
        let length = integer(packet, record + 4);
        if offset == 0 && length == 0 {
            styles.push(None);
            continue;
        }
        let next = offset.checked_add(length).ok_or(1u32)?;
        if offset != cursor || length < 32 || !length.is_multiple_of(8) || next > packet.len() {
            return Err(1);
        }
        styles.push(Some(&packet[offset..next]));
        style_bytes = style_bytes.checked_add(length).ok_or(6u32)?;
        cursor = next;
    }
    if cursor != packet.len() {
        return Err(1);
    }
    let reserved = packet
        .len()
        .checked_sub(source_bytes)
        .and_then(|n| n.checked_sub(style_bytes))
        .and_then(|n| n.checked_add(output.len()))
        .and_then(|n| n.checked_add(resident_extra))
        .ok_or(6u32)?;
    let prepared =
        prepare_styled_document_reserved(decoded.job(), &styles, reserved).map_err(|error| {
            match error {
                StyledDocumentError::Style(code) => code,
                StyledDocumentError::MemoryBudget
                | StyledDocumentError::Composite(DocumentCompositeError::MemoryBudget) => 6,
                StyledDocumentError::WorkBudget
                | StyledDocumentError::Composite(DocumentCompositeError::WorkBudget) => 7,
                _ => 2,
            }
        })?;
    // Publish only after every nested style has completed successfully.
    output.copy_from_slice(document);
    let header = integer(document, 8);
    let record_bytes = if header == 80 { 80 } else { 40 };
    for index in 0..count {
        let offset = integer(document, header + index * record_bytes);
        let rgba = prepared.prepared_rgba(index);
        output[offset..offset + rgba.len()].copy_from_slice(rgba);
    }
    Ok(())
}

/// # Safety
/// Use live allocator pairs; output must not overlap the input envelope.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_document_prepare_styles(
    packet_ptr: *const u8,
    packet_len: usize,
    output_ptr: *mut u8,
    output_len: usize,
    resident_extra: usize,
) -> u32 {
    if packet_ptr.is_null() || output_ptr.is_null() {
        return 3;
    }
    if [packet_len, output_len]
        .iter()
        .any(|n| *n == 0 || *n > MAX_POC_BYTES || !n.is_multiple_of(4))
    {
        return 1;
    }
    let start = packet_ptr as usize;
    let target = output_ptr as usize;
    let Some(end) = start.checked_add(packet_len) else {
        return 1;
    };
    let Some(target_end) = target.checked_add(output_len) else {
        return 1;
    };
    if start < target_end && target < end {
        return 5;
    }
    match prepare_document_style_packet(
        std::slice::from_raw_parts(packet_ptr, packet_len),
        std::slice::from_raw_parts_mut(output_ptr, output_len),
        resident_extra,
    ) {
        Ok(()) => 0,
        Err(code) => code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_packet::compose_document_packet;

    fn set(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    fn double(bytes: &mut [u8], offset: usize, value: f64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
    fn packet() -> Vec<u8> {
        let mut bytes = vec![0; 236];
        bytes[..4].copy_from_slice(b"SDP1");
        for (offset, value) in [
            (4, 1),
            (8, 32),
            (12, 1),
            (16, 40),
            (20, 164),
            (32, 204),
            (36, 32),
        ] {
            set(&mut bytes, offset, value);
        }
        let doc = &mut bytes[40..204];
        doc[..4].copy_from_slice(b"DCP2");
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
            set(doc, offset, value);
        }
        for (offset, value) in [
            (40, 1.0),
            (48, 1.0),
            (104, 100.0),
            (112, 1.0),
            (136, 1.0),
            (144, 0.25),
        ] {
            double(doc, offset, value);
        }
        doc[160..164].copy_from_slice(&[20, 40, 60, 101]);
        let style = &mut bytes[204..];
        style[..4].copy_from_slice(b"STG1");
        set(style, 4, 1);
        double(style, 16, 73.5);
        bytes
    }

    #[test]
    fn prepares_an_owned_dcp2_packet_without_changing_source_or_geometry() {
        let input = packet();
        let original = input.clone();
        let mut output = [99; 164];
        prepare_document_style_packet(&input, &mut output, 0).unwrap();
        assert_eq!(input, original);
        assert_eq!(&output[..160], &input[40..200]);
        assert_eq!(&output[160..], &[20, 40, 60, 74]);
        let mut rgba = [99; 8];
        compose_document_packet(&output, &mut rgba).unwrap();
        assert_eq!(rgba, [20, 40, 60, 56, 20, 40, 60, 19]);
    }

    #[test]
    fn malformed_envelope_and_nested_styles_preserve_output() {
        for (offset, value) in [
            (4, 2),
            (8, 40),
            (12, 1025),
            (16, 44),
            (20, 160),
            (24, 1),
            (32, 208),
            (36, 24),
            (204, 0),
            (208, 2),
            (212, 65),
        ] {
            let mut input = packet();
            set(&mut input, offset, value);
            let mut output = [99; 164];
            assert!(prepare_document_style_packet(&input, &mut output, 0).is_err());
            assert_eq!(output, [99; 164]);
        }
        let mut input = packet();
        double(&mut input, 220, f64::NAN);
        let mut output = [99; 164];
        assert_eq!(
            prepare_document_style_packet(&input, &mut output, 0),
            Err(2)
        );
        assert_eq!(output, [99; 164]);
    }

    #[test]
    fn extra_resident_cache_is_charged_before_style_rasters() {
        let mut output = [99; 164];
        for extra in [96 * 1024 * 1024, usize::MAX] {
            assert_eq!(
                prepare_document_style_packet(&packet(), &mut output, extra),
                Err(6)
            );
            assert_eq!(output, [99; 164]);
        }
    }

    #[test]
    fn none_style_does_not_apply_fill_or_allocate_a_styled_source() {
        let mut input = packet();
        set(&mut input, 32, 0);
        set(&mut input, 36, 0);
        input.truncate(204);
        let mut output = [99; 164];
        prepare_document_style_packet(&input, &mut output, 0).unwrap();
        assert_eq!(&output[..], &input[40..]);
    }

    #[test]
    fn output_length_and_trailing_bytes_are_not_accepted() {
        let mut input = packet();
        let mut short = [99; 160];
        assert!(prepare_document_style_packet(&input, &mut short, 0).is_err());
        assert_eq!(short, [99; 160]);
        input.extend([0; 4]);
        let mut output = [99; 164];
        assert!(prepare_document_style_packet(&input, &mut output, 0).is_err());
        assert_eq!(output, [99; 164]);
    }

    #[test]
    fn abi_rejects_null_and_overlap_before_creating_slice_aliases() {
        let mut input = packet();
        let ptr = input.as_mut_ptr();
        let snapshot = input.clone();
        assert_eq!(
            unsafe { axia_poc_document_prepare_styles(ptr, input.len(), ptr.add(40), 164, 0) },
            5
        );
        assert_eq!(input, snapshot);
        assert_eq!(
            unsafe { axia_poc_document_prepare_styles(std::ptr::null(), input.len(), ptr, 164, 0) },
            3
        );
    }
}
