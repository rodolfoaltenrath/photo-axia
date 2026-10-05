//! Contours and noise shared by mask-based effects.
pub(crate) fn contour_value(preset: u32, points: &[(f64, f64)], value: f64) -> f64 {
    let x = value.clamp(0.0, 1.0);
    match preset {
        1 => (1.0 - (x * 2.0 - 1.0).abs()).clamp(0.0, 1.0),
        2 => (x * 2.0 - 1.0).abs().clamp(0.0, 1.0),
        3 => x * x * (3.0 - 2.0 * x),
        4 => (x * std::f64::consts::PI).sin().clamp(0.0, 1.0),
        5 => {
            // Preserve TS's first-point result after the last custom point too.
            match points.iter().position(|point| point.0 >= x) {
                None | Some(0) => points[0].1,
                Some(right) => {
                    let (before_x, before_y) = points[right - 1];
                    let (after_x, after_y) = points[right];
                    let span = after_x - before_x;
                    if span <= 0.0 {
                        after_y
                    } else {
                        (before_y + (after_y - before_y) * ((x - before_x) / span)).clamp(0.0, 1.0)
                    }
                }
            }
        }
        _ => x,
    }
}

pub(crate) fn random_at(seed: u32, index: usize) -> f64 {
    let mut value = seed ^ (index as u32).wrapping_add(1).wrapping_mul(0x45d9f3b);
    value ^= value >> 16;
    value = value.wrapping_mul(0x45d9f3b);
    // JS's final ^= produces a signed int32, including negative noise values.
    f64::from((value ^ (value >> 16)) as i32) / 4294967295.0
}
