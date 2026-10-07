//! Prepared document stack with integer fast path and affine sampling.

use crate::composite::{composite_pixel_values, BlendMode};
use crate::document_transform::{DocumentAffine, DocumentOutputGrid, DocumentSampler};
use crate::{RasterRegion, MAX_POC_BYTES};

const MAX_AXIS: usize = 16_384;
const MAX_TRANSFORM_SAMPLES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_LAYERS: usize = 1_024;
pub(crate) const MAX_JOB_BYTES: usize = 96 * 1024 * 1024;
pub(crate) const LAYER_METADATA_BYTES: usize = 128;

#[derive(Clone, Copy, Debug)]
pub struct DocumentRasterLayer<'a> {
    pub rgba: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub x: i32,
    pub y: i32,
    pub visible: bool,
    pub opacity: f64,
    pub blend_mode: BlendMode,
    pub transform: Option<DocumentAffine>,
}

#[derive(Clone, Copy, Debug)]
pub struct DocumentCompositeJob<'a> {
    pub document_width: u32,
    pub document_height: u32,
    pub region: RasterRegion,
    pub resolution_scale: f64,
    pub output_grid: Option<DocumentOutputGrid>,
    pub layers_bottom_to_top: &'a [DocumentRasterLayer<'a>],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentCompositeError {
    InvalidDocument,
    InvalidRegion,
    InvalidRaster,
    InvalidOpacity,
    UnsupportedScale,
    MemoryBudget,
    TooManyLayers,
    InvalidTransform,
    WorkBudget,
}

fn raster_bytes(width: usize, height: usize) -> Result<usize, DocumentCompositeError> {
    if width == 0 || height == 0 || width > MAX_AXIS || height > MAX_AXIS {
        return Err(DocumentCompositeError::InvalidRaster);
    }
    let bytes = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or(DocumentCompositeError::MemoryBudget)?;
    if bytes > MAX_POC_BYTES {
        return Err(DocumentCompositeError::MemoryBudget);
    }
    Ok(bytes)
}

fn validate_job(
    job: DocumentCompositeJob<'_>,
    output_len: usize,
) -> Result<(), DocumentCompositeError> {
    if job.document_width == 0 || job.document_height == 0 {
        return Err(DocumentCompositeError::InvalidDocument);
    }
    if job.resolution_scale != 1.0 {
        return Err(DocumentCompositeError::UnsupportedScale);
    }
    if let Some(grid) = job.output_grid {
        grid.validate()?;
    }
    let region = job.region;
    if region.x > u32::MAX as usize
        || region.y > u32::MAX as usize
        || region
            .x
            .checked_add(region.width)
            .is_none_or(|right| right > u32::MAX as usize)
        || region
            .y
            .checked_add(region.height)
            .is_none_or(|bottom| bottom > u32::MAX as usize)
    {
        return Err(DocumentCompositeError::InvalidRegion);
    }
    let output_bytes = raster_bytes(region.width, region.height)?;
    if output_len != output_bytes {
        return Err(DocumentCompositeError::InvalidRaster);
    }
    if job.layers_bottom_to_top.len() > MAX_LAYERS {
        return Err(DocumentCompositeError::TooManyLayers);
    }
    let mut total = output_bytes + job.layers_bottom_to_top.len() * LAYER_METADATA_BYTES;
    let mut samples = 0usize;
    for layer in job.layers_bottom_to_top {
        let bytes = raster_bytes(layer.width, layer.height)?;
        if layer.rgba.len() != bytes {
            return Err(DocumentCompositeError::InvalidRaster);
        }
        if !layer.opacity.is_finite() || !(0.0..=100.0).contains(&layer.opacity) {
            return Err(DocumentCompositeError::InvalidOpacity);
        }
        if layer.transform.is_some() && (job.output_grid.is_none() || layer.x != 0 || layer.y != 0)
        {
            return Err(DocumentCompositeError::InvalidTransform);
        }
        if let Some(grid) = job.output_grid {
            let sampler = DocumentSampler::new(
                layer.transform.unwrap_or(DocumentAffine([
                    1.0,
                    0.0,
                    0.0,
                    1.0,
                    f64::from(layer.x),
                    f64::from(layer.y),
                ])),
                grid,
                layer.width,
                layer.height,
                job.document_width,
                job.document_height,
            )?;
            if layer.visible && layer.opacity > 0.0 {
                if let Some(bounds) = sampler.bounds(region) {
                    samples = samples
                        .checked_add(bounds.width * bounds.height)
                        .ok_or(DocumentCompositeError::WorkBudget)?;
                    if samples > MAX_TRANSFORM_SAMPLES {
                        return Err(DocumentCompositeError::WorkBudget);
                    }
                }
            }
        }
        // Count every reference, including hidden layers and shared buffers.
        total = total
            .checked_add(bytes)
            .ok_or(DocumentCompositeError::MemoryBudget)?;
        if total > MAX_JOB_BYTES {
            return Err(DocumentCompositeError::MemoryBudget);
        }
    }
    Ok(())
}

pub fn compose_document_region(
    job: DocumentCompositeJob<'_>,
    output: &mut [u8],
) -> Result<(), DocumentCompositeError> {
    // No output changes until every layer has passed preflight.
    validate_job(job, output.len())?;
    output.fill(0);
    let region = job.region;
    let region_x = region.x as i64;
    let region_y = region.y as i64;
    let right = (region_x + region.width as i64).min(i64::from(job.document_width));
    let bottom = (region_y + region.height as i64).min(i64::from(job.document_height));
    for layer in job.layers_bottom_to_top {
        if !layer.visible || layer.opacity == 0.0 {
            continue;
        }
        if let Some(grid) = job.output_grid {
            let sampler = DocumentSampler::new(
                layer.transform.unwrap_or(DocumentAffine([
                    1.0,
                    0.0,
                    0.0,
                    1.0,
                    f64::from(layer.x),
                    f64::from(layer.y),
                ])),
                grid,
                layer.width,
                layer.height,
                job.document_width,
                job.document_height,
            )
            .expect("validated sampler");
            if let Some(bounds) = sampler.bounds(region) {
                for y in bounds.y..bounds.y + bounds.height {
                    for x in bounds.x..bounds.x + bounds.width {
                        let (color, alpha) = sampler.sample(layer.rgba, x, y);
                        let index = ((y - region.y) * region.width + x - region.x) * 4;
                        let target: &mut [u8; 4] = (&mut output[index..index + 4])
                            .try_into()
                            .expect("validated RGBA output");
                        composite_pixel_values(
                            target,
                            color,
                            alpha * (layer.opacity / 100.0),
                            layer.blend_mode,
                        );
                        if target[3] == 0 {
                            target.fill(0);
                        }
                    }
                }
            }
            continue;
        }
        let layer_x = i64::from(layer.x);
        let layer_y = i64::from(layer.y);
        let left = region_x.max(layer_x);
        let top = region_y.max(layer_y);
        let layer_right = right.min(layer_x + layer.width as i64);
        let layer_bottom = bottom.min(layer_y + layer.height as i64);
        if left >= layer_right || top >= layer_bottom {
            continue;
        }
        let opacity = layer.opacity / 100.0;
        for y in top..layer_bottom {
            let source_row = (y - layer_y) as usize * layer.width;
            let output_row = (y - region_y) as usize * region.width;
            for x in left..layer_right {
                let source_index = (source_row + (x - layer_x) as usize) * 4;
                let pixel = &layer.rgba[source_index..source_index + 4];
                if pixel[3] == 0 {
                    continue;
                }
                let output_index = (output_row + (x - region_x) as usize) * 4;
                let target: &mut [u8; 4] = (&mut output[output_index..output_index + 4])
                    .try_into()
                    .expect("validated RGBA output");
                composite_pixel_values(
                    target,
                    [
                        f64::from(pixel[0]),
                        f64::from(pixel[1]),
                        f64::from(pixel[2]),
                    ],
                    f64::from(pixel[3]) * opacity,
                    layer.blend_mode,
                );
                if target[3] == 0 {
                    target.fill(0);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_allowance_covers_native_layer_descriptor() {
        assert!(std::mem::size_of::<DocumentRasterLayer<'_>>() <= LAYER_METADATA_BYTES);
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

    fn render(job: DocumentCompositeJob<'_>) -> Vec<u8> {
        let mut output = vec![99; job.region.width * job.region.height * 4];
        compose_document_region(job, &mut output).unwrap();
        output
    }

    #[test]
    fn empty_stack_clears_the_entire_output() {
        assert_eq!(render(job(&[], 2, 3)), vec![0; 24]);
    }

    #[test]
    fn explicit_bottom_to_top_order_controls_the_backdrop() {
        let red = [240, 20, 10, 255];
        let blue = [10, 30, 230, 255];
        assert_eq!(
            render(job(&[layer(&red, 1, 1), layer(&blue, 1, 1)], 1, 1)),
            blue
        );
        assert_eq!(
            render(job(&[layer(&blue, 1, 1), layer(&red, 1, 1)], 1, 1)),
            red
        );
    }

    #[test]
    fn partial_alpha_composes_in_straight_alpha() {
        let layers = [
            layer(&[100, 150, 200, 128], 1, 1),
            layer(&[200, 50, 100, 128], 1, 1),
        ];
        assert_eq!(render(job(&layers, 1, 1)), [167, 83, 133, 192]);
    }

    #[test]
    fn fractional_opacity_is_not_rounded_before_composition() {
        let mut foreground = layer(&[200, 80, 30, 255], 1, 1);
        foreground.opacity = 50.0;
        assert_eq!(render(job(&[foreground], 1, 1)), [200, 80, 30, 128]);
        let black = layer(&[0, 0, 0, 255], 1, 1);
        foreground.opacity = 0.1;
        assert_eq!(render(job(&[foreground], 1, 1)), [0; 4]);
        assert_eq!(render(job(&[black, foreground], 1, 1)), [0, 0, 0, 255]);
    }

    #[test]
    fn all_six_modes_have_fixed_opaque_backdrop_results() {
        for (mode, expected) in [
            (BlendMode::Normal, [200, 100, 50, 255]),
            (BlendMode::Multiply, [78, 59, 39, 255]),
            (BlendMode::Screen, [222, 191, 211, 255]),
            (BlendMode::Overlay, [157, 127, 167, 255]),
            (BlendMode::Darken, [100, 100, 50, 255]),
            (BlendMode::Lighten, [200, 150, 200, 255]),
        ] {
            let mut foreground = layer(&[200, 100, 50, 255], 1, 1);
            foreground.blend_mode = mode;
            assert_eq!(
                render(job(&[layer(&[100, 150, 200, 255], 1, 1), foreground], 1, 1)),
                expected
            );
        }
    }

    #[test]
    fn hidden_and_zero_opacity_layers_do_not_modify_the_stack() {
        let source = [255, 0, 0, 255];
        let mut hidden = layer(&source, 1, 1);
        hidden.visible = false;
        let mut transparent = hidden;
        transparent.visible = true;
        transparent.opacity = 0.0;
        assert_eq!(render(job(&[hidden, transparent], 1, 1)), [0; 4]);
    }

    #[test]
    fn transparent_source_rgb_does_not_leak() {
        let layers = [
            layer(&[255, 40, 80, 0], 1, 1),
            layer(&[12, 23, 34, 128], 1, 1),
        ];
        assert_eq!(render(job(&layers, 1, 1)), [12, 23, 34, 128]);
        assert_eq!(render(job(&layers[..1], 1, 1)), [0; 4]);
    }

    #[test]
    fn blend_modes_do_not_tint_sources_over_transparent_backdrops() {
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let mut source = layer(&[120, 80, 40, 128], 1, 1);
            source.blend_mode = mode;
            assert_eq!(render(job(&[source], 1, 1)), [120, 80, 40, 128]);
        }
    }

    #[test]
    fn positive_translation_leaves_uncovered_pixels_transparent() {
        let mut source = layer(&[12, 34, 56, 255], 1, 1);
        source.x = 1;
        source.y = 1;
        assert_eq!(
            render(job(&[source], 2, 2)),
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 34, 56, 255]
        );
    }

    #[test]
    fn negative_translation_clips_using_absolute_source_coordinates() {
        let rgba = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
        let mut source = layer(&rgba, 2, 2);
        source.x = -1;
        source.y = -1;
        assert_eq!(
            render(job(&[source], 2, 2)),
            [10, 11, 12, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn region_crossing_document_boundary_is_transparent_outside() {
        let rgba = [10, 20, 30, 255].repeat(9);
        let layers = [layer(&rgba, 3, 3)];
        let mut request = job(&layers, 2, 2);
        request.region = RasterRegion {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
        };
        assert_eq!(
            render(request),
            [10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        request.region.x = 10;
        assert_eq!(render(request), [0; 16]);
    }

    #[test]
    fn extreme_layer_origins_are_clipped_without_overflow() {
        for position in [i32::MIN, i32::MAX] {
            let mut source = layer(&[10, 20, 30, 255], 1, 1);
            source.x = position;
            source.y = position;
            assert_eq!(render(job(&[source], 1, 1)), [0; 4]);
        }
        let mut request = job(&[], 1, 1);
        request.document_width = u32::MAX;
        request.document_height = u32::MAX;
        request.region.x = (u32::MAX - 1) as usize;
        request.region.y = (u32::MAX - 1) as usize;
        assert_eq!(render(request), [0; 4]);
    }

    #[test]
    fn adjacent_and_single_pixel_tiles_match_whole_document_byte_for_byte() {
        let background: Vec<u8> = (0..35)
            .flat_map(|i| [i * 7, i * 3, 255 - i * 5, 160])
            .collect();
        let source: Vec<u8> = (0..20)
            .flat_map(|i| [255 - i * 9, i * 11, i * 4, i * 12])
            .collect();
        let mut foreground = layer(&source, 5, 4);
        foreground.x = -1;
        foreground.y = 2;
        foreground.opacity = 63.7;
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            foreground.blend_mode = mode;
            let layers = [layer(&background, 7, 5), foreground];
            let request = job(&layers, 7, 5);
            let whole = render(request);
            for tile_size in [1, 2, 3, 7] {
                let mut stitched = vec![0; whole.len()];
                for y in (0..5).step_by(tile_size) {
                    for x in (0..7).step_by(tile_size) {
                        let region = RasterRegion {
                            x,
                            y,
                            width: tile_size.min(7 - x),
                            height: tile_size.min(5 - y),
                        };
                        let tile = render(DocumentCompositeJob { region, ..request });
                        for row in 0..region.height {
                            let start = ((y + row) * 7 + x) * 4;
                            let source_start = row * region.width * 4;
                            stitched[start..start + region.width * 4].copy_from_slice(
                                &tile[source_start..source_start + region.width * 4],
                            );
                        }
                    }
                }
                assert_eq!(stitched, whole);
            }
        }
    }

    #[test]
    fn invalid_later_layer_does_not_partially_publish_the_valid_one() {
        let layers = [layer(&[1, 2, 3, 255], 1, 1), layer(&[1, 2, 3], 1, 1)];
        let mut output = [91; 4];
        assert_eq!(
            compose_document_region(job(&layers, 1, 1), &mut output),
            Err(DocumentCompositeError::InvalidRaster)
        );
        assert_eq!(output, [91; 4]);
    }

    #[test]
    fn malformed_hidden_or_offscreen_layers_are_still_rejected_atomically() {
        let mut source = layer(&[1, 2, 3], 1, 1);
        source.visible = false;
        source.x = i32::MAX;
        let mut output = [91; 4];
        assert_eq!(
            compose_document_region(job(&[source], 1, 1), &mut output),
            Err(DocumentCompositeError::InvalidRaster)
        );
        assert_eq!(output, [91; 4]);
    }

    #[test]
    fn invalid_opacity_and_unsupported_scale_preserve_output() {
        let mut output = [91; 4];
        for opacity in [f64::NAN, f64::INFINITY, -0.1, 100.1] {
            let mut source = layer(&[1, 2, 3, 255], 1, 1);
            source.opacity = opacity;
            assert_eq!(
                compose_document_region(job(&[source], 1, 1), &mut output),
                Err(DocumentCompositeError::InvalidOpacity)
            );
            assert_eq!(output, [91; 4]);
        }
        for resolution_scale in [0.0, -1.0, 0.5, 2.0, f64::NAN, f64::INFINITY] {
            let request = DocumentCompositeJob {
                resolution_scale,
                ..job(&[], 1, 1)
            };
            assert_eq!(
                compose_document_region(request, &mut output),
                Err(DocumentCompositeError::UnsupportedScale)
            );
            assert_eq!(output, [91; 4]);
        }
    }

    #[test]
    fn invalid_document_region_dimensions_and_output_are_rejected() {
        let mut output = [91; 4];
        let mut request = job(&[], 1, 1);
        request.document_width = 0;
        assert_eq!(
            compose_document_region(request, &mut output),
            Err(DocumentCompositeError::InvalidDocument)
        );
        request = job(&[], 1, 1);
        request.region.x = usize::MAX;
        assert_eq!(
            compose_document_region(request, &mut output),
            Err(DocumentCompositeError::InvalidRegion)
        );
        request.region.x = u32::MAX as usize;
        assert_eq!(
            compose_document_region(request, &mut output),
            Err(DocumentCompositeError::InvalidRegion)
        );
        request = job(&[], 1, 1);
        request.region.width = 0;
        assert_eq!(
            compose_document_region(request, &mut output),
            Err(DocumentCompositeError::InvalidRaster)
        );
        request.region.width = MAX_AXIS + 1;
        assert_eq!(
            compose_document_region(request, &mut output),
            Err(DocumentCompositeError::InvalidRaster)
        );
        request = job(&[], 1, 1);
        assert_eq!(
            compose_document_region(request, &mut []),
            Err(DocumentCompositeError::InvalidRaster)
        );
        assert_eq!(output, [91; 4]);
    }

    #[test]
    fn layer_count_and_shared_source_accounting_are_bounded() {
        let pixel = [1, 2, 3, 255];
        let layers = vec![layer(&pixel, 1, 1); MAX_LAYERS + 1];
        let mut output = [91; 4];
        assert_eq!(
            compose_document_region(job(&layers, 1, 1), &mut output),
            Err(DocumentCompositeError::TooManyLayers)
        );
        let source = vec![0; 1024 * 1024];
        let layers = vec![layer(&source, 512, 512); 96];
        assert_eq!(
            compose_document_region(job(&layers, 1, 1), &mut output),
            Err(DocumentCompositeError::MemoryBudget)
        );
        assert_eq!(output, [91; 4]);
    }

    #[test]
    fn oversized_raster_and_output_are_rejected_without_allocating_them() {
        let layers = [layer(&[], MAX_AXIS, MAX_AXIS)];
        let mut output = [91; 4];
        assert_eq!(
            compose_document_region(job(&layers, 1, 1), &mut output),
            Err(DocumentCompositeError::MemoryBudget)
        );
        assert_eq!(
            compose_document_region(job(&[], MAX_AXIS, MAX_AXIS), &mut output),
            Err(DocumentCompositeError::MemoryBudget)
        );
        assert_eq!(output, [91; 4]);
    }

    #[test]
    fn sources_remain_unchanged_after_rendering() {
        let source = vec![10, 20, 30, 255, 90, 80, 70, 0];
        let original = source.clone();
        let layers = [layer(&source, 2, 1)];
        render(job(&layers, 2, 1));
        assert_eq!(source, original);
    }

    fn affine_job<'a>(
        layers: &'a [DocumentRasterLayer<'a>],
        width: usize,
        height: usize,
    ) -> DocumentCompositeJob<'a> {
        DocumentCompositeJob {
            output_grid: Some(DocumentOutputGrid {
                scale_x: 1.0,
                scale_y: 1.0,
                origin_x: 0.0,
                origin_y: 0.0,
            }),
            ..job(layers, width, height)
        }
    }

    #[test]
    fn identity_grid_preserves_integer_results_in_all_blend_modes() {
        let source: Vec<u8> = (0..140).map(|i| (i * 31 % 256) as u8).collect();
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let mut upper = layer(&source, 7, 5);
            upper.x = -2;
            upper.y = 1;
            upper.opacity = 63.7;
            upper.blend_mode = mode;
            let layers = [layer(&source, 7, 5), upper];
            assert_eq!(
                render(job(&layers, 7, 5)),
                render(affine_job(&layers, 7, 5))
            );
        }
    }

    #[test]
    fn quarter_pixel_translation_uses_geometry_coverage() {
        let mut source = layer(&[30, 60, 90, 255], 1, 1);
        source.transform = Some(DocumentAffine([1.0, 0.0, 0.0, 1.0, 0.25, 0.0]));
        assert_eq!(
            render(affine_job(&[source], 2, 1)),
            [30, 60, 90, 191, 30, 60, 90, 64]
        );
    }

    #[test]
    fn enlarged_opaque_raster_does_not_fade_at_edges() {
        let mut source = layer(&[30, 60, 90, 255], 1, 1);
        source.transform = Some(DocumentAffine([2.0, 0.0, 0.0, 2.0, 0.0, 0.0]));
        assert_eq!(
            render(affine_job(&[source], 2, 2)),
            [30, 60, 90, 255].repeat(4)
        );
    }

    #[test]
    fn bilinear_interpolation_ignores_transparent_texel_rgb() {
        let mut source = layer(&[255, 0, 0, 255, 0, 0, 255, 0], 2, 1);
        source.transform = Some(DocumentAffine([2.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
        assert_eq!(
            render(affine_job(&[source], 4, 1)),
            [255, 0, 0, 255, 255, 0, 0, 191, 255, 0, 0, 64, 0, 0, 0, 0]
        );
    }

    #[test]
    fn rotation_and_reflection_preserve_orientation() {
        let mut source = layer(&[255, 0, 0, 255, 0, 0, 255, 255], 2, 1);
        source.transform = Some(DocumentAffine([0.0, 1.0, -1.0, 0.0, 1.0, 0.0]));
        assert_eq!(render(affine_job(&[source], 1, 2)), source.rgba);
        source.transform = Some(DocumentAffine([-1.0, 0.0, 0.0, 1.0, 2.0, 0.0]));
        assert_eq!(
            render(affine_job(&[source], 2, 1)),
            [0, 0, 255, 255, 255, 0, 0, 255]
        );
    }

    #[test]
    fn downsampling_and_output_origin_are_explicit() {
        let source = layer(&[255, 0, 0, 255, 0, 0, 255, 255], 2, 1);
        let layers = [source];
        let mut request = affine_job(&layers, 2, 1);
        request.region.width = 1;
        request.output_grid.as_mut().unwrap().scale_x = 0.5;
        assert_eq!(render(request), [128, 0, 128, 255]);
        let source = layer(&[30, 60, 90, 255], 1, 1);
        let layers = [source];
        request = affine_job(&layers, 1, 1);
        request.output_grid.as_mut().unwrap().origin_x = 0.25;
        assert_eq!(render(request), [30, 60, 90, 191]);
    }

    #[test]
    fn rotated_fractional_grid_matches_irregular_and_single_pixel_tiles() {
        let pixels: Vec<u8> = (0..80).map(|i| (i * 19 % 256) as u8).collect();
        let mut source = layer(&pixels, 5, 4);
        source.opacity = 63.7;
        source.transform = Some(DocumentAffine([0.8, 0.6, -0.6, 0.8, 3.25, -0.125]));
        let layers = [source];
        let mut request = affine_job(&layers, 10, 9);
        request.output_grid = Some(DocumentOutputGrid {
            scale_x: 1.375,
            scale_y: 0.875,
            origin_x: -0.125,
            origin_y: 0.25,
        });
        request.region.width = 14;
        request.region.height = 8;
        let full = render(request);
        assert!(full.iter().skip(3).step_by(4).any(|v| *v > 0 && *v < 255));
        for tile_size in [1, 2, 3, 7] {
            let mut stitched = vec![0; full.len()];
            for y in (0..8).step_by(tile_size) {
                for x in (0..14).step_by(tile_size) {
                    let region = RasterRegion {
                        x,
                        y,
                        width: tile_size.min(14 - x),
                        height: tile_size.min(8 - y),
                    };
                    let tile = render(DocumentCompositeJob { region, ..request });
                    for row in 0..region.height {
                        let start = ((y + row) * 14 + x) * 4;
                        stitched[start..start + region.width * 4].copy_from_slice(
                            &tile[row * region.width * 4..(row + 1) * region.width * 4],
                        );
                    }
                }
            }
            assert_eq!(stitched, full);
        }
    }

    #[test]
    fn invalid_affine_or_grid_in_hidden_layer_preserves_output() {
        for matrix in [
            [0.0; 6],
            [1.0, 0.0, 0.0, 1.0, f64::NAN, 0.0],
            [1.0, 2.0, 2.0, 4.0, 0.0, 0.0],
            [1e-8, 0.0, 0.0, 1e-8, 0.0, 0.0],
        ] {
            let mut source = layer(&[30, 60, 90, 255], 1, 1);
            source.visible = false;
            source.transform = Some(DocumentAffine(matrix));
            let layers = [source];
            let mut output = [99; 4];
            assert_eq!(
                compose_document_region(affine_job(&layers, 1, 1), &mut output),
                Err(DocumentCompositeError::InvalidTransform)
            );
            assert_eq!(output, [99; 4]);
        }
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, 129.0] {
            let mut request = affine_job(&[], 1, 1);
            request.output_grid.as_mut().unwrap().scale_x = scale;
            let mut output = [99; 4];
            assert_eq!(
                compose_document_region(request, &mut output),
                Err(DocumentCompositeError::UnsupportedScale)
            );
            assert_eq!(output, [99; 4]);
        }
    }

    #[test]
    fn transformed_work_budget_rejects_tiny_sources_expanded_over_many_pixels() {
        let mut source = layer(&[30, 60, 90, 255], 1, 1);
        source.transform = Some(DocumentAffine([1024.0, 0.0, 0.0, 1024.0, 0.0, 0.0]));
        let layers = vec![source; 17];
        let mut output = vec![99; 1024 * 1024 * 4];
        assert_eq!(
            compose_document_region(affine_job(&layers, 1024, 1024), &mut output),
            Err(DocumentCompositeError::WorkBudget)
        );
        assert!(output.iter().all(|v| *v == 99));
    }
}
