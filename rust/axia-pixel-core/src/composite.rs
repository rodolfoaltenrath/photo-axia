//! Straight-alpha effect blending, not document Canvas/GPU blending.

#[derive(Clone, Copy, Debug)]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
}

impl TryFrom<u32> for BlendMode {
    type Error = &'static str;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Normal),
            1 => Ok(Self::Multiply),
            2 => Ok(Self::Screen),
            3 => Ok(Self::Overlay),
            4 => Ok(Self::Darken),
            5 => Ok(Self::Lighten),
            _ => Err("invalid-blend-mode"),
        }
    }
}

fn blend_channel(backdrop: f64, source: f64, mode: BlendMode) -> f64 {
    match mode {
        BlendMode::Normal => source,
        BlendMode::Multiply => backdrop * source,
        BlendMode::Screen => 1.0 - (1.0 - backdrop) * (1.0 - source),
        BlendMode::Overlay => {
            if backdrop <= 0.5 {
                2.0 * backdrop * source
            } else {
                1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source)
            }
        }
        BlendMode::Darken => backdrop.min(source),
        BlendMode::Lighten => backdrop.max(source),
    }
}

pub fn composite_pixel(target: &mut [u8; 4], color: [u8; 3], alpha: u8, mode: BlendMode) {
    composite_pixel_values(target, color.map(f64::from), f64::from(alpha), mode);
}

/// Gradient tails can extrapolate beyond byte ranges (TS parity).
pub fn composite_pixel_values(target: &mut [u8; 4], color: [f64; 3], alpha: f64, mode: BlendMode) {
    if alpha <= 0.0 {
        return;
    }
    let source_alpha = alpha / 255.0;
    let backdrop_alpha = f64::from(target[3]) / 255.0;
    let output_alpha = source_alpha + backdrop_alpha - source_alpha * backdrop_alpha;
    for channel in 0..3 {
        let source = color[channel] / 255.0;
        let backdrop = f64::from(target[channel]) / 255.0;
        let blended = blend_channel(backdrop, source, mode);
        // Do not regroup, fuse multiply-add, or change precision during the port.
        let premultiplied = (1.0 - source_alpha) * backdrop * backdrop_alpha
            + (1.0 - backdrop_alpha) * source * source_alpha
            + source_alpha * backdrop_alpha * blended;
        target[channel] =
            ((premultiplied / output_alpha).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8;
    }
    target[3] = (output_alpha * 255.0 + 0.5).floor() as u8;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transparent_source_preserves_target_and_hidden_rgb() {
        let mut target = [77, 88, 99, 0];
        composite_pixel(&mut target, [255, 0, 0], 0, BlendMode::Normal);
        assert_eq!(target, [77, 88, 99, 0]);
    }

    #[test]
    fn transparent_backdrop_does_not_tint_the_effect() {
        for mode in [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
        ] {
            let mut target = [77, 88, 99, 0];
            composite_pixel(&mut target, [200, 120, 40], 128, mode);
            assert_eq!(target, [200, 120, 40, 128]);
        }
    }
}
