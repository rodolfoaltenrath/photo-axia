use crate::blend_if::{apply_underlying_region, BlendIfChannel, UnderlyingBlendIf};
use crate::composite::{composite_pixel_values, BlendMode};
use crate::document_composite::*;
use crate::document_transform::{DocumentAffine, DocumentOutputGrid};
use crate::RasterRegion;

fn filter(channel: BlendIfChannel) -> UnderlyingBlendIf {
    UnderlyingBlendIf {
        channel,
        shadows: [0, 128],
        highlights: [200, 255],
    }
}
fn layer(rgba: &[u8]) -> DocumentRasterLayer<'_> {
    DocumentRasterLayer {
        rgba,
        width: rgba.len() / 4,
        height: 1,
        x: 0,
        y: 0,
        visible: true,
        opacity: 100.0,
        blend_mode: BlendMode::Normal,
        transform: None,
        underlying_blend_if: None,
        sampling: crate::document_transform::DocumentSampling::CoverageBilinear,
    }
}
fn job<'a>(layers: &'a [DocumentRasterLayer<'a>], width: usize) -> DocumentCompositeJob<'a> {
    DocumentCompositeJob {
        document_width: width as u32,
        document_height: 1,
        region: RasterRegion {
            x: 0,
            y: 0,
            width,
            height: 1,
        },
        resolution_scale: 1.0,
        output_grid: None,
        layers_bottom_to_top: layers,
    }
}
fn render(job: DocumentCompositeJob<'_>) -> Vec<u8> {
    let mut output = vec![0; job.region.width * job.region.height * 4];
    compose_document_region(job, &mut output).unwrap();
    output
}

#[test]
fn underlying_rounds_opacity_then_filter_not_their_product() {
    let base = [64, 20, 30, 255];
    let source = [255, 255, 255, 1];
    let mut upper = layer(&source);
    upper.opacity = 50.0;
    upper.underlying_blend_if = Some(filter(BlendIfChannel::Red));
    assert_eq!(render(job(&[layer(&base), upper], 1)), [65, 21, 31, 255]);
    upper.opacity = 0.0;
    assert_eq!(render(job(&[layer(&base), upper], 1)), base);
}

#[test]
fn all_channels_modes_and_partial_backdrops_match_the_standalone_filter() {
    let backdrop = [64, 125, 200, 109];
    let source = [240, 50, 130, 101];
    for channel in [
        BlendIfChannel::Gray,
        BlendIfChannel::Red,
        BlendIfChannel::Green,
        BlendIfChannel::Blue,
    ] {
        let config = filter(channel);
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let mut upper = layer(&source);
            upper.opacity = 63.7;
            upper.blend_mode = mode;
            upper.underlying_blend_if = Some(config);
            let mut input = source;
            input[3] = (f64::from(source[3]) * 0.637 + 0.5).floor() as u8;
            let mut filtered = [0; 4];
            apply_underlying_region(
                &input,
                1,
                1,
                job(&[], 1).region,
                &backdrop,
                &mut filtered,
                config,
            )
            .unwrap();
            let mut expected = backdrop;
            composite_pixel_values(
                &mut expected,
                [240.0, 50.0, 130.0],
                f64::from(filtered[3]),
                mode,
            );
            assert_eq!(render(job(&[layer(&backdrop), upper], 1)), expected);
        }
    }
}

#[test]
fn default_ranges_keep_the_original_fractional_alpha_path() {
    let source = [250, 20, 100, 3];
    let base = [11, 80, 160, 71];
    let mut upper = layer(&source);
    upper.opacity = 13.5;
    let expected = render(job(&[layer(&base), upper], 1));
    upper.underlying_blend_if = Some(UnderlyingBlendIf {
        channel: BlendIfChannel::Red,
        shadows: [0, 0],
        highlights: [255, 255],
    });
    assert_eq!(render(job(&[layer(&base), upper], 1)), expected);
}

#[test]
fn transparent_backdrop_uses_composed_black_not_hidden_source_rgb() {
    let hidden = [255, 255, 255, 0];
    let source = [100, 70, 40, 255];
    let mut upper = layer(&source);
    upper.underlying_blend_if = Some(filter(BlendIfChannel::Red));
    assert_eq!(render(job(&[layer(&hidden), upper], 1)), [0, 0, 0, 0]);
    upper.underlying_blend_if = Some(UnderlyingBlendIf {
        channel: BlendIfChannel::Red,
        shadows: [0, 0],
        highlights: [80, 80],
    });
    assert_eq!(render(job(&[layer(&hidden), upper], 1)), source);
}

#[test]
fn consecutive_filtered_layers_read_the_updated_backdrop() {
    let base = [64, 0, 0, 255];
    let red = [192, 0, 0, 255];
    let blue = [0, 0, 255, 255];
    let mut middle = layer(&red);
    middle.underlying_blend_if = Some(filter(BlendIfChannel::Red));
    let mut upper = layer(&blue);
    upper.underlying_blend_if = Some(UnderlyingBlendIf {
        channel: BlendIfChannel::Red,
        shadows: [100, 100],
        highlights: [255, 255],
    });
    assert_eq!(render(job(&[layer(&base), middle, upper], 1)), blue);
    assert_eq!(render(job(&[layer(&base), upper], 1)), base);
}

#[test]
fn invalid_hidden_or_zero_opacity_filter_is_rejected_before_clearing_output() {
    let source = [10, 20, 30, 255];
    let mut upper = layer(&source);
    upper.underlying_blend_if = Some(UnderlyingBlendIf {
        channel: BlendIfChannel::Red,
        shadows: [90, 10],
        highlights: [255, 255],
    });
    for (visible, opacity) in [(false, 100.0), (true, 0.0), (true, 100.0)] {
        upper.visible = visible;
        upper.opacity = opacity;
        let mut output = [99; 4];
        assert_eq!(
            compose_document_region(job(&[layer(&source), upper], 1), &mut output),
            Err(DocumentCompositeError::InvalidBlendIf)
        );
        assert_eq!(output, [99; 4]);
    }
}

#[test]
fn affine_filter_quantizes_source_before_blend_and_tiles_match() {
    let base = [64, 20, 30, 255, 192, 70, 10, 255];
    let source = [240, 50, 130, 101];
    let mut upper = layer(&source);
    upper.opacity = 63.7;
    upper.underlying_blend_if = Some(filter(BlendIfChannel::Red));
    upper.transform = Some(DocumentAffine([1.0, 0.0, 0.0, 1.0, 0.25, 0.0]));
    let layers = [layer(&base), upper];
    let request = DocumentCompositeJob {
        output_grid: Some(DocumentOutputGrid {
            scale_x: 1.0,
            scale_y: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
        }),
        ..job(&layers, 2)
    };
    let full = render(request);
    let mut expected = Vec::new();
    for (index, coverage) in [0.75, 0.25].into_iter().enumerate() {
        let mut target: [u8; 4] = base[index * 4..index * 4 + 4].try_into().unwrap();
        let alpha = (101.0_f64 * coverage * 0.637 + 0.5).floor();
        let filtered = (alpha * filter(BlendIfChannel::Red).opacity(&target) + 0.5).floor();
        composite_pixel_values(
            &mut target,
            [240.0, 50.0, 130.0],
            filtered,
            BlendMode::Normal,
        );
        expected.extend_from_slice(&target);
        assert_eq!(
            render(DocumentCompositeJob {
                region: RasterRegion {
                    x: index,
                    y: 0,
                    width: 1,
                    height: 1
                },
                ..request
            }),
            full[index * 4..index * 4 + 4]
        );
    }
    assert_eq!(full, expected);
}

#[test]
fn integer_filter_work_budget_rejects_before_output_changes() {
    let pixels = vec![128; 4000 * 1000 * 4];
    let filtered = DocumentRasterLayer {
        width: 4000,
        height: 1000,
        underlying_blend_if: Some(filter(BlendIfChannel::Red)),
        ..layer(&pixels)
    };
    let layers = [filtered; 5];
    let request = DocumentCompositeJob {
        document_width: 4000,
        document_height: 1000,
        region: RasterRegion {
            x: 0,
            y: 0,
            width: 4000,
            height: 1000,
        },
        ..job(&layers, 4000)
    };
    let mut output = vec![99; pixels.len()];
    assert_eq!(
        compose_document_region(request, &mut output),
        Err(DocumentCompositeError::WorkBudget)
    );
    assert!(output.iter().all(|value| *value == 99));
}
