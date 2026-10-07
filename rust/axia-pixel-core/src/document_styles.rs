//! Prepare styles once, then reuse immutable sources for document tiles.

use crate::document_composite::{
    compose_document_region, raster_bytes, validate_job, DocumentCompositeError,
    DocumentCompositeJob, MAX_JOB_BYTES,
};
use crate::stages::{prepare_style_stages, style_metadata_bytes};
use crate::RasterRegion;

const LAYER_WORKSPACE_BYTES: usize = 512;
const KERNEL_METADATA_BYTES: usize = 2048;
const MAX_STYLE_PASS_PIXELS: usize = 16 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum StyledDocumentError {
    Composite(DocumentCompositeError),
    Style(u32),
    MemoryBudget,
    WorkBudget,
}

impl From<DocumentCompositeError> for StyledDocumentError {
    fn from(error: DocumentCompositeError) -> Self {
        Self::Composite(error)
    }
}

fn style_error(status: u32) -> StyledDocumentError {
    if status == 6 {
        StyledDocumentError::MemoryBudget
    } else {
        StyledDocumentError::Style(status)
    }
}

fn add_bytes(total: usize, extra: usize) -> Result<usize, StyledDocumentError> {
    let value = total
        .checked_add(extra)
        .ok_or(StyledDocumentError::MemoryBudget)?;
    if value > MAX_JOB_BYTES {
        return Err(StyledDocumentError::MemoryBudget);
    }
    Ok(value)
}

pub struct PreparedStyledDocument<'a> {
    job: DocumentCompositeJob<'a>,
    styled: Vec<Option<Vec<u8>>>,
    resident_bytes: usize,
}

impl PreparedStyledDocument<'_> {
    pub fn resident_bytes(&self) -> usize {
        self.resident_bytes
    }

    pub fn compose_region(
        &self,
        region: RasterRegion,
        output: &mut [u8],
    ) -> Result<(), StyledDocumentError> {
        let output_bytes = raster_bytes(region.width, region.height)?;
        if output.len() != output_bytes {
            return Err(DocumentCompositeError::InvalidRaster.into());
        }
        add_bytes(self.resident_bytes, output_bytes)?;
        let mut layers = Vec::new();
        layers
            .try_reserve_exact(self.styled.len())
            .map_err(|_| StyledDocumentError::MemoryBudget)?;
        for (layer, styled) in self.job.layers_bottom_to_top.iter().zip(&self.styled) {
            let mut prepared = *layer;
            if let Some(rgba) = styled {
                prepared.rgba = rgba;
            }
            layers.push(prepared);
        }
        compose_document_region(
            DocumentCompositeJob {
                region,
                layers_bottom_to_top: &layers,
                ..self.job
            },
            output,
        )?;
        Ok(())
    }
}

pub fn prepare_styled_document<'a>(
    job: DocumentCompositeJob<'a>,
    style_packets: &[Option<&[u8]>],
) -> Result<PreparedStyledDocument<'a>, StyledDocumentError> {
    let output_bytes = raster_bytes(job.region.width, job.region.height)?;
    validate_job(job, output_bytes)?;
    let count = job.layers_bottom_to_top.len();
    if style_packets.len() != count {
        return Err(StyledDocumentError::Style(2));
    }
    let mut resident = count * LAYER_WORKSPACE_BYTES;
    let mut packets = 0;
    let mut metadata = 0;
    for (layer, packet) in job.layers_bottom_to_top.iter().zip(style_packets) {
        resident = add_bytes(resident, layer.rgba.len())?;
        if let Some(packet) = packet {
            packets = add_bytes(packets, packet.len())?;
            metadata = add_bytes(metadata, style_metadata_bytes(packet).map_err(style_error)?)?;
            if layer.visible && layer.opacity > 0.0 {
                resident = add_bytes(resident, layer.rgba.len())?;
            }
        }
    }
    let base = add_bytes(
        add_bytes(add_bytes(resident, packets)?, metadata)?,
        output_bytes,
    )?;
    let mut plans = Vec::new();
    plans
        .try_reserve_exact(count)
        .map_err(|_| StyledDocumentError::MemoryBudget)?;
    let mut pass_pixels = 0usize;
    for (layer, packet) in job.layers_bottom_to_top.iter().zip(style_packets) {
        let plan = packet
            .map(|packet| {
                prepare_style_stages(
                    layer.rgba.len(),
                    layer.width,
                    layer.height,
                    RasterRegion {
                        x: 0,
                        y: 0,
                        width: layer.width,
                        height: layer.height,
                    },
                    packet,
                    layer.rgba.len(),
                )
            })
            .transpose()
            .map_err(style_error)?;
        if let Some(plan) = &plan {
            if layer.visible && layer.opacity > 0.0 {
                let scratch = layer
                    .rgba
                    .len()
                    .checked_mul(2)
                    .and_then(|n| n.checked_add(plan.peak_filter_bytes))
                    .and_then(|n| n.checked_add(KERNEL_METADATA_BYTES))
                    .ok_or(StyledDocumentError::MemoryBudget)?;
                add_bytes(base, scratch)?;
                pass_pixels = pass_pixels
                    .checked_add(plan.pass_pixels())
                    .ok_or(StyledDocumentError::WorkBudget)?;
                if pass_pixels > MAX_STYLE_PASS_PIXELS {
                    return Err(StyledDocumentError::WorkBudget);
                }
            }
        }
        plans.push(plan);
    }
    // All nested packets and the aggregate peak are checked before raster allocation.
    let mut styled = Vec::new();
    styled
        .try_reserve_exact(count)
        .map_err(|_| StyledDocumentError::MemoryBudget)?;
    for (layer, plan) in job.layers_bottom_to_top.iter().zip(&plans) {
        let rgba = if layer.visible && layer.opacity > 0.0 {
            if let Some(plan) = plan {
                let mut rgba = Vec::new();
                rgba.try_reserve_exact(layer.rgba.len())
                    .map_err(|_| StyledDocumentError::MemoryBudget)?;
                rgba.resize(layer.rgba.len(), 0);
                plan.execute(layer.rgba, &mut rgba).map_err(style_error)?;
                Some(rgba)
            } else {
                None
            }
        } else {
            None
        };
        styled.push(rgba);
    }
    Ok(PreparedStyledDocument {
        job,
        styled,
        resident_bytes: resident,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composite::BlendMode;
    use crate::document_composite::DocumentRasterLayer;
    use crate::document_transform::{DocumentAffine, DocumentOutputGrid};
    use crate::stages::{apply_style_stages, PreparedStyleStages};

    fn set(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    fn double(bytes: &mut [u8], offset: usize, value: f64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
    fn styles(fill: f64, effects: &[(u32, u32, Vec<u8>)]) -> Vec<u8> {
        let header = 32 + effects.len() * 16;
        let mut packet = vec![0; header];
        packet[..4].copy_from_slice(b"STG1");
        set(&mut packet, 4, 1);
        set(&mut packet, 8, effects.len() as u32);
        double(&mut packet, 16, fill);
        for (index, (kind, stage, payload)) in effects.iter().enumerate() {
            let record = 32 + index * 16;
            let offset = packet.len();
            set(&mut packet, record, *kind);
            set(&mut packet, record + 4, *stage);
            set(&mut packet, record + 8, offset as u32);
            set(&mut packet, record + 12, payload.len() as u32);
            packet.extend(payload);
            packet.resize(packet.len().div_ceil(8) * 8, 0);
        }
        packet
    }
    fn overlay(color: [u8; 4]) -> (u32, u32, Vec<u8>) {
        let mut bytes = vec![0; 128];
        bytes[..4].copy_from_slice(b"AXB1");
        set(&mut bytes, 4, 1);
        set(&mut bytes, 8, 1);
        set(&mut bytes, 32, 1);
        double(&mut bytes, 40, 100.0);
        bytes[84..88].copy_from_slice(&color);
        (6, 3, bytes)
    }
    fn shadow() -> (u32, u32, Vec<u8>) {
        let mut bytes = vec![0; 64];
        bytes[..4].copy_from_slice(b"SHD1");
        set(&mut bytes, 4, 1);
        set(&mut bytes, 16, 1);
        bytes[32..36].copy_from_slice(&[255, 0, 0, 255]);
        double(&mut bytes, 48, 100.0);
        (1, 0, bytes)
    }
    fn stroke() -> (u32, u32, Vec<u8>) {
        let mut bytes = vec![0; 96];
        bytes[..4].copy_from_slice(b"STK1");
        set(&mut bytes, 4, 1);
        set(&mut bytes, 8, 1);
        bytes[24..28].copy_from_slice(&[0, 0, 255, 255]);
        double(&mut bytes, 56, 100.0);
        double(&mut bytes, 64, 1.0);
        double(&mut bytes, 80, 1.0);
        (8, 4, bytes)
    }
    fn layer(rgba: &[u8], width: usize, height: usize) -> DocumentRasterLayer<'_> {
        DocumentRasterLayer {
            rgba,
            width,
            height,
            x: 0,
            y: 0,
            visible: true,
            opacity: 100.0,
            blend_mode: BlendMode::Normal,
            transform: None,
        }
    }
    fn job<'a>(
        layers: &'a [DocumentRasterLayer<'a>],
        width: usize,
        height: usize,
    ) -> DocumentCompositeJob<'a> {
        DocumentCompositeJob {
            document_width: width as u32,
            document_height: height as u32,
            region: RasterRegion {
                x: 0,
                y: 0,
                width,
                height,
            },
            resolution_scale: 1.0,
            output_grid: None,
            layers_bottom_to_top: layers,
        }
    }

    #[test]
    fn workspace_allowance_covers_retained_and_temporary_descriptors() {
        let bytes = 2 * std::mem::size_of::<DocumentRasterLayer<'_>>()
            + std::mem::size_of::<Option<Vec<u8>>>()
            + std::mem::size_of::<Option<PreparedStyleStages<'_>>>()
            + std::mem::size_of::<Option<&[u8]>>();
        assert!(bytes <= LAYER_WORKSPACE_BYTES);
    }

    #[test]
    fn no_style_stack_matches_existing_compositor_in_all_modes() {
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let lower = layer(&[100, 150, 200, 255, 90, 80, 70, 64], 2, 1);
            let upper = DocumentRasterLayer {
                opacity: 62.5,
                blend_mode: mode,
                ..layer(&[30, 60, 90, 101, 77, 88, 99, 0], 2, 1)
            };
            let layers = [lower, upper];
            let request = job(&layers, 2, 1);
            let prepared = prepare_styled_document(request, &[None, None]).unwrap();
            let mut expected = [0; 8];
            let mut output = [99; 8];
            compose_document_region(request, &mut expected).unwrap();
            prepared
                .compose_region(request.region, &mut output)
                .unwrap();
            assert_eq!(output, expected);
            assert!(prepared.styled.iter().all(Option::is_none));
        }
    }

    #[test]
    fn empty_prepared_stack_clears_the_output_without_style_buffers() {
        let request = job(&[], 2, 1);
        let prepared = prepare_styled_document(request, &[]).unwrap();
        let mut output = [99; 8];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [0; 8]);
        assert_eq!(prepared.resident_bytes(), 0);
    }

    #[test]
    fn hidden_sources_skip_style_rasters_but_offscreen_visible_sources_are_prepared() {
        let packet = styles(73.5, &[]);
        let source = [20, 40, 60, 101];
        let layers = [
            DocumentRasterLayer {
                visible: false,
                ..layer(&source, 1, 1)
            },
            DocumentRasterLayer {
                opacity: 0.0,
                ..layer(&source, 1, 1)
            },
            DocumentRasterLayer {
                x: 100,
                ..layer(&source, 1, 1)
            },
        ];
        let request = job(&layers, 1, 1);
        let prepared = prepare_styled_document(request, &[Some(packet.as_slice()); 3]).unwrap();
        assert!(prepared.styled[0].is_none());
        assert!(prepared.styled[1].is_none());
        assert_eq!(prepared.styled[2].as_deref().unwrap(), [20, 40, 60, 74]);
        let mut output = [99; 4];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [0; 4]);
    }

    #[test]
    fn fractional_fill_precedes_layer_opacity_and_is_not_applied_twice() {
        let source = [20, 40, 60, 101, 77, 88, 99, 0];
        let layers = [DocumentRasterLayer {
            opacity: 62.5,
            ..layer(&source, 2, 1)
        }];
        let request = job(&layers, 2, 1);
        let mut packet = styles(73.5, &[]);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        assert_eq!(
            prepared.styled[0].as_deref().unwrap(),
            [20, 40, 60, 74, 0, 0, 0, 0]
        );
        let pointer = prepared.styled[0].as_ref().unwrap().as_ptr();
        // No packet borrow survives preparation, nor another Fill pass per tile.
        double(&mut packet, 16, 0.0);
        for _ in 0..3 {
            let mut output = [99; 8];
            prepared
                .compose_region(request.region, &mut output)
                .unwrap();
            assert_eq!(output, [20, 40, 60, 46, 0, 0, 0, 0]);
            assert_eq!(prepared.styled[0].as_ref().unwrap().as_ptr(), pointer);
        }
        assert_eq!(source, [20, 40, 60, 101, 77, 88, 99, 0]);
    }

    #[test]
    fn zero_fill_preserves_overlay_from_the_original_alpha_mask() {
        let layers = [layer(&[20, 40, 60, 101], 1, 1)];
        let request = job(&layers, 1, 1);
        let packet = styles(0.0, &[overlay([255, 0, 0, 255])]);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 4];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [255, 0, 0, 101]);
    }

    #[test]
    fn zero_fill_preserves_external_shadow_and_applies_layer_opacity_once() {
        let layers = [DocumentRasterLayer {
            opacity: 50.0,
            ..layer(&[0, 0, 0, 0, 20, 40, 60, 255, 0, 0, 0, 0], 3, 1)
        }];
        let request = job(&layers, 3, 1);
        let packet = styles(0.0, &[shadow()]);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 12];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 128]);
    }

    #[test]
    fn stroke_keeps_circular_corners_and_original_mask_after_zero_fill() {
        let mut source = [0; 100];
        source[48..52].copy_from_slice(&[255, 0, 0, 255]);
        let layers = [layer(&source, 5, 5)];
        let request = job(&layers, 5, 5);
        let packet = styles(0.0, &[stroke()]);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 100];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        for index in 0..25 {
            let expected = if [7, 11, 13, 17].contains(&index) {
                [0, 0, 255, 255]
            } else {
                [0; 4]
            };
            assert_eq!(&output[index * 4..index * 4 + 4], &expected);
        }
    }

    #[test]
    fn this_layer_filter_reads_overlay_color_before_document_transform() {
        let layers = [layer(&[20, 40, 60, 255], 1, 1)];
        let request = job(&layers, 1, 1);
        let mut packet = styles(100.0, &[overlay([255, 0, 0, 255])]);
        packet[12..16].copy_from_slice(&[0, 0, 100, 100]);
        set(&mut packet, 24, 1);
        set(&mut packet, 28, 1);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 4];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [0; 4]);
    }

    #[test]
    fn padded_source_offset_is_preserved_by_rotation_without_recentering() {
        let mut source = [0; 60];
        source[28..32].copy_from_slice(&[0, 255, 0, 255]);
        let layers = [DocumentRasterLayer {
            opacity: 41.0,
            transform: Some(DocumentAffine([0.0, 1.0, -1.0, 0.0, 3.0, -2.0])),
            ..layer(&source, 5, 3)
        }];
        let request = DocumentCompositeJob {
            output_grid: Some(DocumentOutputGrid {
                scale_x: 1.0,
                scale_y: 1.0,
                origin_x: 0.0,
                origin_y: 0.0,
            }),
            ..job(&layers, 3, 3)
        };
        let packet = styles(50.0, &[shadow()]);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 36];
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        let mut expected = [0; 36];
        expected[4..8].copy_from_slice(&[0, 255, 0, 52]);
        expected[16..20].copy_from_slice(&[255, 0, 0, 105]);
        assert_eq!(output, expected);
    }

    #[test]
    fn styled_rotated_tiles_match_whole_and_separate_existing_kernels() {
        let source: Vec<u8> = (0..60).map(|i| (i * 19 % 256) as u8).collect();
        let lower_packet = styles(73.5, &[overlay([0, 255, 0, 96])]);
        let upper_packet = styles(35.5, &[shadow(), overlay([255, 0, 0, 128]), stroke()]);
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let layers = [
                DocumentRasterLayer {
                    transform: Some(DocumentAffine([1.0, 0.0, 0.0, 1.0, 1.125, 0.25])),
                    ..layer(&source, 5, 3)
                },
                DocumentRasterLayer {
                    opacity: 63.7,
                    blend_mode: mode,
                    transform: Some(DocumentAffine([0.8, 0.6, -0.6, 0.8, 3.25, 1.125])),
                    ..layer(&source, 5, 3)
                },
            ];
            let request = DocumentCompositeJob {
                region: RasterRegion {
                    x: 0,
                    y: 0,
                    width: 11,
                    height: 7,
                },
                output_grid: Some(DocumentOutputGrid {
                    scale_x: 1.375,
                    scale_y: 0.875,
                    origin_x: 0.125,
                    origin_y: -0.25,
                }),
                ..job(&layers, 8, 7)
            };
            let prepared =
                prepare_styled_document(request, &[Some(&lower_packet), Some(&upper_packet)])
                    .unwrap();
            let mut lower = vec![0; source.len()];
            let mut upper = lower.clone();
            let source_region = RasterRegion {
                x: 0,
                y: 0,
                width: 5,
                height: 3,
            };
            apply_style_stages(&source, 5, 3, source_region, &lower_packet, &mut lower).unwrap();
            apply_style_stages(&source, 5, 3, source_region, &upper_packet, &mut upper).unwrap();
            let expected_layers = [
                DocumentRasterLayer {
                    rgba: &lower,
                    ..layers[0]
                },
                DocumentRasterLayer {
                    rgba: &upper,
                    ..layers[1]
                },
            ];
            let mut expected = vec![0; 11 * 7 * 4];
            compose_document_region(
                DocumentCompositeJob {
                    layers_bottom_to_top: &expected_layers,
                    ..request
                },
                &mut expected,
            )
            .unwrap();
            let mut whole = expected.clone();
            prepared.compose_region(request.region, &mut whole).unwrap();
            assert_eq!(whole, expected);
            for size in [1, 2, 3, 7] {
                let mut stitched = vec![0; whole.len()];
                for y in (0..7).step_by(size) {
                    for x in (0..11).step_by(size) {
                        let region = RasterRegion {
                            x,
                            y,
                            width: size.min(11 - x),
                            height: size.min(7 - y),
                        };
                        let mut tile = vec![0; region.width * region.height * 4];
                        prepared.compose_region(region, &mut tile).unwrap();
                        for row in 0..region.height {
                            stitched
                                [((y + row) * 11 + x) * 4..((y + row) * 11 + x + region.width) * 4]
                                .copy_from_slice(
                                    &tile[row * region.width * 4..(row + 1) * region.width * 4],
                                );
                        }
                    }
                }
                assert_eq!(stitched, whole);
            }
        }
    }

    #[test]
    fn invalid_later_hidden_zero_opacity_or_offscreen_style_rejects_preparation() {
        let valid = styles(100.0, &[]);
        let invalid = styles(f64::NAN, &[]);
        for (visible, opacity, x) in [(false, 100.0, 0), (true, 0.0, 0), (true, 100.0, 100)] {
            let layers = [
                layer(&[20, 40, 60, 255], 1, 1),
                DocumentRasterLayer {
                    visible,
                    opacity,
                    x,
                    ..layer(&[20, 40, 60, 255], 1, 1)
                },
            ];
            assert!(matches!(
                prepare_styled_document(job(&layers, 1, 1), &[Some(&valid), Some(&invalid)]),
                Err(StyledDocumentError::Style(2))
            ));
        }
    }

    #[test]
    fn packet_count_and_stage_order_are_not_silently_repaired() {
        let layers = [layer(&[20, 40, 60, 255], 1, 1)];
        assert!(matches!(
            prepare_styled_document(job(&layers, 1, 1), &[]),
            Err(StyledDocumentError::Style(2))
        ));
        let packet = styles(100.0, &[overlay([255, 0, 0, 255]), shadow()]);
        assert!(matches!(
            prepare_styled_document(job(&layers, 1, 1), &[Some(&packet)]),
            Err(StyledDocumentError::Style(2))
        ));
    }

    #[test]
    fn aggregate_budget_counts_all_styled_sources_and_executor_peak() {
        let source = vec![0; 4096 * 512 * 4];
        let packet = styles(100.0, &[]);
        let layers = [layer(&source, 4096, 512); 5];
        // Each standalone job needs about 32 MiB, but together the peak exceeds 96 MiB.
        assert!(prepare_style_stages(
            source.len(),
            4096,
            512,
            RasterRegion {
                x: 0,
                y: 0,
                width: 4096,
                height: 512
            },
            &packet,
            source.len()
        )
        .is_ok());
        assert!(matches!(
            prepare_styled_document(job(&layers, 1, 1), &[Some(packet.as_slice()); 5]),
            Err(StyledDocumentError::MemoryBudget)
        ));
    }

    #[test]
    fn style_work_budget_rejects_many_passes_even_with_a_small_document_tile() {
        let source = vec![0; 512 * 512 * 4];
        let packet = styles(100.0, &vec![overlay([255, 0, 0, 255]); 64]);
        let layers = [layer(&source, 512, 512)];
        assert!(matches!(
            prepare_styled_document(job(&layers, 1, 1), &[Some(&packet)]),
            Err(StyledDocumentError::WorkBudget)
        ));
    }

    #[test]
    fn compose_failure_preserves_output_and_prepared_buffers_remain_reusable() {
        let packet = styles(73.5, &[]);
        let layers = [layer(&[20, 40, 60, 101], 1, 1)];
        let request = job(&layers, 1, 1);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut output = [99; 4];
        assert!(prepared
            .compose_region(
                RasterRegion {
                    x: u32::MAX as usize,
                    ..request.region
                },
                &mut output
            )
            .is_err());
        assert_eq!(output, [99; 4]);
        prepared
            .compose_region(request.region, &mut output)
            .unwrap();
        assert_eq!(output, [20, 40, 60, 74]);
    }

    #[test]
    fn failed_new_preparation_does_not_invalidate_an_existing_appearance() {
        let packet = styles(73.5, &[overlay([255, 0, 0, 255])]);
        let layers = [layer(&[20, 40, 60, 255], 1, 1)];
        let request = job(&layers, 1, 1);
        let prepared = prepare_styled_document(request, &[Some(&packet)]).unwrap();
        let mut before = [0; 4];
        prepared
            .compose_region(request.region, &mut before)
            .unwrap();
        let mut invalid = packet.clone();
        double(&mut invalid, 16, f64::NAN);
        assert!(prepare_styled_document(request, &[Some(&invalid)]).is_err());
        let mut after = [99; 4];
        prepared.compose_region(request.region, &mut after).unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn compose_budget_includes_raw_sources_not_only_the_prepared_appearance() {
        let source = vec![0; 1536 * 2048 * 4];
        let layers = [layer(&source, 1536, 2048); 6];
        let request = job(&layers, 1, 1);
        let prepared = prepare_styled_document(request, &[None; 6]).unwrap();
        assert_eq!(
            prepared.resident_bytes(),
            source.len() * 6 + 6 * LAYER_WORKSPACE_BYTES
        );
        let mut output = vec![99; 3072 * 2048 * 4];
        assert_eq!(
            prepared.compose_region(
                RasterRegion {
                    x: 0,
                    y: 0,
                    width: 3072,
                    height: 2048
                },
                &mut output
            ),
            Err(StyledDocumentError::MemoryBudget)
        );
        assert!(output.iter().all(|v| *v == 99));
    }
}
