use crate::composite::BlendMode;
use crate::document_composite::{
    compose_document_region, DocumentCompositeJob, DocumentRasterLayer,
};
use crate::document_packet::compose_document_packet;
use crate::document_transform::{DocumentAffine, DocumentOutputGrid, DocumentSampling};
use crate::RasterRegion;

fn layer(rgba: &[u8], width: usize, height: usize, matrix: [f64; 6]) -> DocumentRasterLayer<'_> {
    DocumentRasterLayer {
        rgba,
        width,
        height,
        x: 0,
        y: 0,
        visible: true,
        opacity: 100.0,
        blend_mode: BlendMode::Normal,
        transform: Some(DocumentAffine(matrix)),
        underlying_blend_if: None,
        sampling: DocumentSampling::RasterBilinear,
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
        output_grid: Some(DocumentOutputGrid {
            scale_x: 1.0,
            scale_y: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
        }),
        layers_bottom_to_top: layers,
    }
}
fn render(job: DocumentCompositeJob<'_>) -> Vec<u8> {
    let mut output = vec![99; job.region.width * job.region.height * 4];
    compose_document_region(job, &mut output).unwrap();
    output
}

#[test]
fn raster_translation_does_not_apply_geometric_edge_alpha_twice() {
    let mut source = layer(&[255, 0, 0, 255], 1, 1, [1.0, 0.0, 0.0, 1.0, 0.25, 0.0]);
    assert_eq!(render(job(&[source], 2, 1)), [255, 0, 0, 255, 0, 0, 0, 0]);
    source.sampling = DocumentSampling::CoverageBilinear;
    assert_eq!(
        render(job(&[source], 2, 1)),
        [255, 0, 0, 191, 255, 0, 0, 64]
    );
}

#[test]
fn raster_half_pixel_edges_round_towards_positive_coordinates() {
    let mut source = layer(&[255, 0, 0, 255], 1, 1, [1.0, 0.0, 0.0, 1.0, 0.5, 0.0]);
    assert_eq!(render(job(&[source], 2, 1)), [0, 0, 0, 0, 255, 0, 0, 255]);
    source.transform = Some(DocumentAffine([1.0, 0.0, 0.0, 1.0, -0.5, 0.0]));
    assert_eq!(render(job(&[source], 2, 1)), [255, 0, 0, 255, 0, 0, 0, 0]);
}

#[test]
fn raster_bilinear_weights_preserve_hidden_rgb_isolation_and_source() {
    let bytes = [255, 0, 0, 255, 0, 0, 255, 0];
    let source = layer(&bytes, 2, 1, [1.0, 0.0, 0.0, 1.0, 0.25, 0.0]);
    assert_eq!(
        render(job(&[source], 3, 1)),
        [255, 0, 0, 255, 255, 0, 0, 64, 0, 0, 0, 0]
    );
    assert_eq!(bytes, [255, 0, 0, 255, 0, 0, 255, 0]);
}

#[test]
fn raster_four_bit_weights_are_explicit_not_color_depth_reduction() {
    let mut source = layer(
        &[255, 0, 0, 255, 0, 255, 0, 255],
        2,
        1,
        [1.5, 0.0, 0.0, 1.0, 0.25, 0.0],
    );
    assert_eq!(
        render(job(&[source], 4, 1)),
        [255, 0, 0, 255, 175, 80, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]
    );
    source.sampling = DocumentSampling::RasterBilinearPrecise;
    assert_eq!(
        render(job(&[source], 4, 1)),
        [255, 0, 0, 255, 170, 85, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]
    );
}

#[test]
fn raster_quarter_rotation_and_fractional_position_preserve_orientation() {
    let source = layer(
        &[255, 0, 0, 255, 0, 255, 0, 255],
        2,
        1,
        [0.0, 1.0, -1.0, 0.0, 1.5, 0.25],
    );
    let result = render(job(&[source], 3, 3));
    assert_eq!(&result[4..8], [255, 0, 0, 255]);
    assert_eq!(&result[16..20], [64, 191, 0, 255]);
    assert!(result
        .as_chunks::<4>()
        .0
        .iter()
        .enumerate()
        .all(|(i, p)| i == 1 || i == 4 || *p == [0, 0, 0, 0]));
}

#[test]
fn raster_global_tiles_match_whole_in_all_modes_without_extra_source_buffers() {
    let pixels: Vec<u8> = (0..24).map(|i| (i * 31 % 256) as u8).collect();
    for matrix in [
        [1.5, 0.0, 0.0, 2.0, 0.25, -0.5],
        [0.0, 1.5, -2.0, 0.0, 6.5, 0.25],
        [-1.5, 0.0, 0.0, 2.0, 5.25, 0.5],
    ] {
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let mut upper = layer(&pixels, 3, 2, matrix);
            upper.opacity = 63.7;
            upper.blend_mode = mode;
            let layers = [layer(&pixels, 3, 2, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0]), upper];
            let request = job(&layers, 8, 7);
            let full = render(request);
            for size in [1, 2, 3, 7] {
                let mut stitched = vec![0; full.len()];
                for y in (0..7).step_by(size) {
                    for x in (0..8).step_by(size) {
                        let region = RasterRegion {
                            x,
                            y,
                            width: size.min(8 - x),
                            height: size.min(7 - y),
                        };
                        let tile = render(DocumentCompositeJob { region, ..request });
                        for row in 0..region.height {
                            let start = ((y + row) * 8 + x) * 4;
                            stitched[start..start + region.width * 4].copy_from_slice(
                                &tile[row * region.width * 4..(row + 1) * region.width * 4],
                            );
                        }
                    }
                }
                assert_eq!(stitched, full);
            }
        }
    }
}

#[test]
fn unsupported_raster_sampling_rejects_even_hidden_layers_before_output_write() {
    for matrix in [
        // Below the bilinear minimum: reductions under 0.5 belong to RasterArea.
        [0.25, 0.0, 0.0, 1.0, 0.0, 0.0],
        [1.0, 0.1, 0.0, 1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0, 1.0, f64::NAN, 0.0],
    ] {
        let mut source = layer(&[255, 0, 0, 255], 1, 1, matrix);
        source.visible = false;
        let mut output = [99; 4];
        assert!(compose_document_region(job(&[source], 1, 1), &mut output).is_err());
        assert_eq!(output, [99; 4]);
    }
    let layers = [layer(
        &[255, 0, 0, 255],
        1,
        1,
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    )];
    for grid in [
        None,
        Some(DocumentOutputGrid {
            scale_x: 2.0,
            scale_y: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
        }),
        Some(DocumentOutputGrid {
            scale_x: 1.0,
            scale_y: 1.0,
            origin_x: 0.25,
            origin_y: 0.0,
        }),
    ] {
        let mut request = job(&layers, 1, 1);
        request.output_grid = grid;
        let mut output = [99; 4];
        assert!(compose_document_region(request, &mut output).is_err());
        assert_eq!(output, [99; 4]);
    }
}

#[test]
fn dcp4_sampler_is_versioned_and_malformed_modes_preserve_output() {
    let mut packet = vec![0; 180];
    packet[..4].copy_from_slice(b"DCP4");
    for (offset, value) in [
        (4, 4u32),
        (8, 80),
        (12, 1),
        (16, 2),
        (20, 1),
        (32, 2),
        (36, 1),
        (80, 176),
        (84, 4),
        (88, 1),
        (92, 1),
        (96, 1),
        (172, 1),
    ] {
        packet[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    for (offset, value) in [
        (40, 1.0f64),
        (48, 1.0),
        (104, 100.0),
        (112, 1.0),
        (136, 1.0),
        (144, 0.25),
    ] {
        packet[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
    packet[176..].copy_from_slice(&[255, 0, 0, 255]);
    let mut output = [99; 8];
    compose_document_packet(&packet, &mut output).unwrap();
    assert_eq!(output, [255, 0, 0, 255, 0, 0, 0, 0]);
    // Mode 3 is RasterArea; 4 is the first unknown mode.
    for (offset, value) in [(172, 4), (160, 2), (164, 1), (72, 1)] {
        let mut invalid = packet.clone();
        invalid[offset] = value;
        output.fill(99);
        assert!(compose_document_packet(&invalid, &mut output).is_err());
        assert_eq!(output, [99; 8]);
    }
    packet[3] = b'3';
    packet[4] = 3;
    output.fill(99);
    assert!(compose_document_packet(&packet, &mut output).is_err());
    assert_eq!(output, [99; 8]);
}

fn area(rgba: &[u8], width: usize, height: usize, matrix: [f64; 6]) -> DocumentRasterLayer<'_> {
    DocumentRasterLayer {
        sampling: DocumentSampling::RasterArea,
        ..layer(rgba, width, height, matrix)
    }
}

#[test]
fn area_averages_the_exact_box_in_premultiplied_space() {
    // red | blue | green | transparent red-hidden texel, halved horizontally.
    let bytes = [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 0];
    let source = area(&bytes, 4, 1, [0.5, 0.0, 0.0, 1.0, 0.0, 0.0]);
    // Left: mean of red and blue. Right: green over half the footprint, and the hidden
    // RGB of the transparent texel must not tint it.
    assert_eq!(
        render(job(&[source], 2, 1)),
        [128, 0, 128, 255, 0, 255, 0, 128]
    );
}

#[test]
fn area_gives_partially_covered_edges_exact_area_alpha() {
    let red = [255, 0, 0, 255].repeat(4);
    let source = area(&red, 2, 2, [0.5, 0.0, 0.0, 0.5, 0.25, 0.0]);
    // The 1×1 footprint covers x in [0.25, 1.25]: 75% of pixel 0 and 25% of pixel 1.
    assert_eq!(
        render(job(&[source], 2, 1)),
        [255, 0, 0, 191, 255, 0, 0, 64]
    );
}

#[test]
fn area_quarter_turn_averages_the_rotated_footprint() {
    let bytes = [
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ];
    let source = area(&bytes, 2, 2, [0.0, 0.5, -0.5, 0.0, 1.0, 0.0]);
    assert_eq!(render(job(&[source], 1, 1)), [128, 128, 128, 255]);
}

#[test]
fn area_rejects_magnification_shear_and_mixed_scales() {
    for matrix in [
        [2.0, 0.0, 0.0, 2.0, 0.0, 0.0],
        [0.3, 0.0, 0.0, 2.0, 0.0, 0.0],
        [0.3, 0.1, 0.0, 0.3, 0.0, 0.0],
    ] {
        let source = area(&[255, 0, 0, 255], 1, 1, matrix);
        let mut output = [99; 4];
        assert!(compose_document_region(job(&[source], 1, 1), &mut output).is_err());
        assert_eq!(output, [99; 4]);
    }
}

#[test]
fn area_tiles_match_the_whole_render_in_global_coordinates() {
    let pixels: Vec<u8> = (0..16 * 12 * 4).map(|i| (i * 37 % 256) as u8).collect();
    for matrix in [
        [0.3, 0.0, 0.0, 0.3, 0.75, 1.5],
        [0.0, 0.45, -0.35, 0.0, 6.25, 0.5],
        [-0.25, 0.0, 0.0, 0.4, 5.5, 0.125],
    ] {
        let source = area(&pixels, 16, 12, matrix);
        let layers = [source];
        let whole = render(job(&layers, 8, 6));
        for (x, y, width, height) in [(0, 0, 3, 2), (3, 0, 5, 2), (0, 2, 8, 4)] {
            let mut request = job(&layers, 8, 6);
            request.region = RasterRegion {
                x,
                y,
                width,
                height,
            };
            let tile = render(request);
            for row in 0..height {
                let start = ((y + row) * 8 + x) * 4;
                assert_eq!(
                    &tile[row * width * 4..(row + 1) * width * 4],
                    &whole[start..start + width * 4]
                );
            }
        }
    }
}

#[test]
fn area_work_per_sample_counts_the_source_footprint() {
    use crate::document_transform::DocumentSampler;
    let grid = DocumentOutputGrid {
        scale_x: 1.0,
        scale_y: 1.0,
        origin_x: 0.0,
        origin_y: 0.0,
    };
    let work = |matrix: [f64; 6], sampling| {
        DocumentSampler::new(DocumentAffine(matrix), grid, 64, 64, 64, 64, sampling)
            .unwrap()
            .work_per_sample()
    };
    assert_eq!(
        work(
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            DocumentSampling::RasterBilinear
        ),
        1
    );
    assert_eq!(
        work(
            [0.25, 0.0, 0.0, 0.25, 0.0, 0.0],
            DocumentSampling::RasterArea
        ),
        25
    );
    assert_eq!(
        work(
            [0.0, 0.5, -0.1, 0.0, 0.0, 0.0],
            DocumentSampling::RasterArea
        ),
        33
    );
}

#[test]
fn whole_texel_shortcut_equals_the_four_tap_sum_for_every_byte() {
    // The sampler returns the texel when the bilinear weights are (1, 0, 0, 0); this is
    // the exact four-tap sum it replaces, for every color/alpha and arbitrary neighbors.
    for alpha in 1..=255u8 {
        for color in 0..=255u8 {
            let neighbors = [
                (color ^ 0x5a, alpha.wrapping_mul(7)),
                (255 - color, 255 - alpha),
                (alpha, color),
            ];
            let mut sum_alpha = 0.0;
            let mut sum_color = 0.0;
            for (value, weight_alpha, weight) in [(color, alpha, 1.0)]
                .into_iter()
                .chain(neighbors.map(|(value, a)| (value, a, 0.0)))
            {
                let contribution = f64::from(weight_alpha) * weight;
                sum_alpha += contribution;
                sum_color += f64::from(value) * contribution;
            }
            assert_eq!(
                (sum_color / sum_alpha).to_bits(),
                f64::from(color).to_bits()
            );
            assert_eq!(sum_alpha.to_bits(), f64::from(alpha).to_bits());
        }
    }
}
