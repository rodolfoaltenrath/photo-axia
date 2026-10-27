//! Global pixel centers, premultiplied bilinear samples and quad coverage.

use crate::document_composite::DocumentCompositeError;
use crate::RasterRegion;

#[derive(Clone, Copy, Debug)]
pub struct DocumentOutputGrid {
    pub scale_x: f64,
    pub scale_y: f64,
    pub origin_x: f64,
    pub origin_y: f64,
}

impl DocumentOutputGrid {
    pub fn validate(self) -> Result<(), DocumentCompositeError> {
        if [self.scale_x, self.scale_y]
            .iter()
            .any(|v| !v.is_finite() || !(1.0 / 1024.0..=128.0).contains(v))
            || [self.origin_x, self.origin_y]
                .iter()
                .any(|v| !v.is_finite() || v.abs() > f64::from(u32::MAX))
        {
            return Err(DocumentCompositeError::UnsupportedScale);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DocumentAffine(pub [f64; 6]);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DocumentSampling {
    #[default]
    CoverageBilinear,
    RasterBilinear,
    RasterBilinearPrecise,
    /// Exact box-filter average over each output pixel's source footprint. Used for
    /// reductions below 0.5, where bilinear starts skipping texels and aliases.
    RasterArea,
}

/// Smallest axis scale the raster bilinear modes accept. Below it bilinear samples
/// stop touching every texel; `RasterArea` covers that range instead.
pub const RASTER_BILINEAR_MIN_SCALE: f64 = 0.5;

impl DocumentAffine {
    pub fn validate(self) -> Result<(), DocumentCompositeError> {
        self.inverse_basis().map(|_| ())
    }

    fn inverse_basis(self) -> Result<[f64; 4], DocumentCompositeError> {
        let [a, b, c, d, tx, ty] = self.0;
        if [a, b, c, d]
            .iter()
            .any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
            || [tx, ty]
                .iter()
                .any(|v| !v.is_finite() || v.abs() > f64::from(u32::MAX))
        {
            return Err(DocumentCompositeError::InvalidTransform);
        }
        let det = a * d - b * c;
        if !det.is_finite() || det.abs() < 1e-12 {
            return Err(DocumentCompositeError::InvalidTransform);
        }
        let inverse = [d / det, -b / det, -c / det, a / det];
        if inverse
            .iter()
            .any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
        {
            return Err(DocumentCompositeError::InvalidTransform);
        }
        Ok(inverse)
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Point {
    x: f64,
    y: f64,
}

pub(crate) struct DocumentSampler {
    grid: DocumentOutputGrid,
    inverse: [f64; 4],
    translation: [f64; 2],
    quad: [Point; 4],
    document: [f64; 4],
    width: usize,
    height: usize,
    margin_x: f64,
    margin_y: f64,
    sampling: DocumentSampling,
    raster_clip: [f64; 4],
}

impl DocumentSampler {
    pub fn new(
        mut transform: DocumentAffine,
        grid: DocumentOutputGrid,
        width: usize,
        height: usize,
        document_width: u32,
        document_height: u32,
        sampling: DocumentSampling,
    ) -> Result<Self, DocumentCompositeError> {
        grid.validate()?;
        if sampling != DocumentSampling::CoverageBilinear {
            if grid.scale_x != 1.0
                || grid.scale_y != 1.0
                || grid.origin_x.fract() != 0.0
                || grid.origin_y.fract() != 0.0
            {
                return Err(DocumentCompositeError::UnsupportedScale);
            }
            for value in &mut transform.0[..4] {
                if value.abs() <= 1e-12 {
                    *value = 0.0;
                }
            }
            let [a, b, c, d, _, _] = transform.0;
            // Axis-aligned or quarter turn; scales are the non-zero pair.
            let scales = if b == 0.0 && c == 0.0 {
                Some((a.abs(), d.abs()))
            } else if a == 0.0 && d == 0.0 {
                Some((b.abs(), c.abs()))
            } else {
                None
            };
            let supported = scales.is_some_and(|(sx, sy)| {
                if sampling == DocumentSampling::RasterArea {
                    sx > 0.0 && sy > 0.0 && sx <= 1.0 && sy <= 1.0
                } else {
                    sx >= RASTER_BILINEAR_MIN_SCALE && sy >= RASTER_BILINEAR_MIN_SCALE
                }
            });
            if !supported {
                return Err(DocumentCompositeError::InvalidTransform);
            }
        }
        let inverse = transform.inverse_basis()?;
        let [a, b, c, d, tx, ty] = transform.0;
        let quad = [
            (0.0, 0.0),
            (width as f64, 0.0),
            (width as f64, height as f64),
            (0.0, height as f64),
        ]
        .map(|(x, y)| Point {
            x: ((a * x + c * y + tx) - grid.origin_x) * grid.scale_x,
            y: ((b * x + d * y + ty) - grid.origin_y) * grid.scale_y,
        });
        if quad.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return Err(DocumentCompositeError::InvalidTransform);
        }
        let document = [
            -grid.origin_x * grid.scale_x,
            -grid.origin_y * grid.scale_y,
            (f64::from(document_width) - grid.origin_x) * grid.scale_x,
            (f64::from(document_height) - grid.origin_y) * grid.scale_y,
        ];
        let raster_clip = [
            quad.iter()
                .map(|p| p.x)
                .fold(f64::INFINITY, f64::min)
                .max(document[0]),
            quad.iter()
                .map(|p| p.y)
                .fold(f64::INFINITY, f64::min)
                .max(document[1]),
            quad.iter()
                .map(|p| p.x)
                .fold(f64::NEG_INFINITY, f64::max)
                .min(document[2]),
            quad.iter()
                .map(|p| p.y)
                .fold(f64::NEG_INFINITY, f64::max)
                .min(document[3]),
        ]
        .map(|edge| (edge + 0.5 + 1e-9).floor());
        Ok(Self {
            grid,
            inverse,
            translation: [tx, ty],
            quad,
            width,
            height,
            document,
            margin_x: 0.5 * (inverse[0].abs() / grid.scale_x + inverse[2].abs() / grid.scale_y),
            margin_y: 0.5 * (inverse[1].abs() / grid.scale_x + inverse[3].abs() / grid.scale_y),
            sampling,
            raster_clip,
        })
    }

    pub fn bounds(&self, region: RasterRegion) -> Option<RasterRegion> {
        let left = self
            .quad
            .iter()
            .map(|p| p.x)
            .fold(f64::INFINITY, f64::min)
            .max(self.document[0])
            .floor()
            .max(region.x as f64);
        let top = self
            .quad
            .iter()
            .map(|p| p.y)
            .fold(f64::INFINITY, f64::min)
            .max(self.document[1])
            .floor()
            .max(region.y as f64);
        let right = self
            .quad
            .iter()
            .map(|p| p.x)
            .fold(f64::NEG_INFINITY, f64::max)
            .min(self.document[2])
            .ceil()
            .min((region.x + region.width) as f64);
        let bottom = self
            .quad
            .iter()
            .map(|p| p.y)
            .fold(f64::NEG_INFINITY, f64::max)
            .min(self.document[3])
            .ceil()
            .min((region.y + region.height) as f64);
        if left >= right || top >= bottom {
            return None;
        }
        Some(RasterRegion {
            x: left as usize,
            y: top as usize,
            width: (right - left) as usize,
            height: (bottom - top) as usize,
        })
    }

    /// Texel offset `(u - x, v - y)` when every output pixel is exactly one source texel.
    /// All four sampling modes then return that texel unchanged, so callers may skip them.
    pub fn integer_offset(&self) -> Option<(i64, i64)> {
        let whole = |value: f64| value.fract() == 0.0 && value.abs() <= f64::from(1u32 << 30);
        (self.inverse == [1.0, 0.0, 0.0, 1.0]
            && self.grid.scale_x == 1.0
            && self.grid.scale_y == 1.0
            && [
                self.grid.origin_x,
                self.grid.origin_y,
                self.translation[0],
                self.translation[1],
            ]
            .into_iter()
            .all(whole))
        .then(|| {
            (
                (self.grid.origin_x - self.translation[0]) as i64,
                (self.grid.origin_y - self.translation[1]) as i64,
            )
        })
    }

    /// Upper bound of source texels read per output sample, for the work budget.
    pub fn work_per_sample(&self) -> usize {
        if self.sampling != DocumentSampling::RasterArea {
            return 1;
        }
        // A unit output pixel maps to a source footprint of these extents.
        let footprint_u = (self.inverse[0].abs() / self.grid.scale_x
            + self.inverse[2].abs() / self.grid.scale_y)
            .ceil();
        let footprint_v = (self.inverse[1].abs() / self.grid.scale_x
            + self.inverse[3].abs() / self.grid.scale_y)
            .ceil();
        // Validated scales keep both extents within [1, 1e6]; saturate rather than wrap.
        ((footprint_u as usize).saturating_add(1))
            .saturating_mul((footprint_v as usize).saturating_add(1))
    }

    /// Box-filter average of the source over the output pixel square, in premultiplied
    /// space. Texels outside the source count as transparent, so partially covered
    /// edge pixels get exact area coverage instead of a hard clip.
    fn sample_area(&self, rgba: &[u8], x: usize, y: usize) -> ([f64; 3], f64) {
        let (px, py) = (x as f64, y as f64);
        if px < self.document[0]
            || py < self.document[1]
            || px + 1.0 > self.document[2]
            || py + 1.0 > self.document[3]
        {
            return ([0.0; 3], 0.0);
        }
        let corners = [(px, py), (px + 1.0, py + 1.0)].map(|(cx, cy)| {
            let dx = cx / self.grid.scale_x + self.grid.origin_x - self.translation[0];
            let dy = cy / self.grid.scale_y + self.grid.origin_y - self.translation[1];
            (
                self.inverse[0] * dx + self.inverse[2] * dy,
                self.inverse[1] * dx + self.inverse[3] * dy,
            )
        });
        let (u0, u1) = (
            corners[0].0.min(corners[1].0),
            corners[0].0.max(corners[1].0),
        );
        let (v0, v1) = (
            corners[0].1.min(corners[1].1),
            corners[0].1.max(corners[1].1),
        );
        let area = (u1 - u0) * (v1 - v0);
        let (cu0, cu1) = (u0.max(0.0), u1.min(self.width as f64));
        let (cv0, cv1) = (v0.max(0.0), v1.min(self.height as f64));
        if area <= 0.0 || cu0 >= cu1 || cv0 >= cv1 {
            return ([0.0; 3], 0.0);
        }
        let mut alpha = 0.0;
        let mut color = [0.0; 3];
        // Fixed summation order (rows, then columns) keeps the result reproducible.
        let mut iy = cv0.floor() as usize;
        while (iy as f64) < cv1 {
            let wy = cv1.min(iy as f64 + 1.0) - cv0.max(iy as f64);
            let mut ix = cu0.floor() as usize;
            while (ix as f64) < cu1 {
                let wx = cu1.min(ix as f64 + 1.0) - cu0.max(ix as f64);
                let offset = (iy * self.width + ix) * 4;
                let contribution = f64::from(rgba[offset + 3]) * (wx * wy);
                alpha += contribution;
                for channel in 0..3 {
                    color[channel] += f64::from(rgba[offset + channel]) * contribution;
                }
                ix += 1;
            }
            iy += 1;
        }
        if alpha == 0.0 {
            return ([0.0; 3], 0.0);
        }
        for channel in &mut color {
            *channel /= alpha;
        }
        (color, alpha / area)
    }

    pub fn sample(&self, rgba: &[u8], x: usize, y: usize) -> ([f64; 3], f64) {
        if self.sampling == DocumentSampling::RasterArea {
            return self.sample_area(rgba, x, y);
        }
        // Evaluate global coordinates independently; never accumulate from tile origin.
        let dx = (x as f64 + 0.5) / self.grid.scale_x + self.grid.origin_x - self.translation[0];
        let dy = (y as f64 + 0.5) / self.grid.scale_y + self.grid.origin_y - self.translation[1];
        let sx = self.inverse[0] * dx + self.inverse[2] * dy;
        let sy = self.inverse[1] * dx + self.inverse[3] * dy;
        let full_document = x as f64 >= self.document[0]
            && y as f64 >= self.document[1]
            && x as f64 + 1.0 <= self.document[2]
            && y as f64 + 1.0 <= self.document[3];
        let coverage = if self.sampling != DocumentSampling::CoverageBilinear {
            if x as f64 >= self.raster_clip[0]
                && y as f64 >= self.raster_clip[1]
                && (x as f64) < self.raster_clip[2]
                && (y as f64) < self.raster_clip[3]
            {
                1.0
            } else {
                0.0
            }
        } else if full_document
            && sx - self.margin_x >= 0.0
            && sy - self.margin_y >= 0.0
            && sx + self.margin_x <= self.width as f64
            && sy + self.margin_y <= self.height as f64
        {
            1.0
        } else {
            coverage(
                self.quad,
                [
                    (self.document[0] - x as f64).max(0.0),
                    (self.document[1] - y as f64).max(0.0),
                    (self.document[2] - x as f64).min(1.0),
                    (self.document[3] - y as f64).min(1.0),
                ],
                x as f64,
                y as f64,
            )
        };
        if coverage <= 0.0 {
            return ([0.0; 3], 0.0);
        }
        let px = (sx - 0.5).clamp(0.0, (self.width - 1) as f64);
        let py = (sy - 0.5).clamp(0.0, (self.height - 1) as f64);
        let ix = px.floor() as usize;
        let iy = py.floor() as usize;
        let quantize = |fraction: f64| {
            if self.sampling == DocumentSampling::RasterBilinear {
                (fraction * 16.0).floor() / 16.0
            } else {
                fraction
            }
        };
        let fx = quantize(px - ix as f64);
        let fy = quantize(py - iy as f64);
        if fx == 0.0 && fy == 0.0 {
            // Weights (1, 0, 0, 0): the sums below reduce exactly to this texel, since
            // color * alpha is an exact integer and dividing it by alpha restores color.
            let texel = &rgba[(iy * self.width + ix) * 4..][..4];
            if texel[3] == 0 {
                return ([0.0; 3], 0.0);
            }
            let color = [texel[0], texel[1], texel[2]].map(f64::from);
            return (color, f64::from(texel[3]) * coverage);
        }
        let mut color = [0.0; 3];
        let mut alpha = 0.0;
        for (cx, cy, weight) in [
            (ix, iy, (1.0 - fx) * (1.0 - fy)),
            ((ix + 1).min(self.width - 1), iy, fx * (1.0 - fy)),
            (ix, (iy + 1).min(self.height - 1), (1.0 - fx) * fy),
            (
                (ix + 1).min(self.width - 1),
                (iy + 1).min(self.height - 1),
                fx * fy,
            ),
        ] {
            let offset = (cy * self.width + cx) * 4;
            let contribution = f64::from(rgba[offset + 3]) * weight;
            alpha += contribution;
            for channel in 0..3 {
                color[channel] += f64::from(rgba[offset + channel]) * contribution;
            }
        }
        if alpha == 0.0 {
            return ([0.0; 3], 0.0);
        }
        for channel in &mut color {
            *channel /= alpha;
        }
        (color, alpha * coverage)
    }
}

fn coverage(quad: [Point; 4], rect: [f64; 4], x: f64, y: f64) -> f64 {
    if rect[0] >= rect[2] || rect[1] >= rect[3] {
        return 0.0;
    }
    let mut points = [Point::default(); 12];
    let mut scratch = points;
    for (index, p) in quad.iter().enumerate() {
        points[index] = Point {
            x: p.x - x,
            y: p.y - y,
        };
    }
    let mut count = 4;
    for (axis, boundary, greater) in [
        (0, rect[0], true),
        (0, rect[2], false),
        (1, rect[1], true),
        (1, rect[3], false),
    ] {
        if count == 0 {
            return 0.0;
        }
        let mut next_count = 0;
        let coordinate = |p: Point| if axis == 0 { p.x } else { p.y };
        let inside = |p: Point| {
            if greater {
                coordinate(p) >= boundary
            } else {
                coordinate(p) <= boundary
            }
        };
        let mut previous = points[count - 1];
        let mut previous_inside = inside(previous);
        for current in points[..count].iter().copied() {
            let current_inside = inside(current);
            if previous_inside != current_inside {
                let t = (boundary - coordinate(previous))
                    / (coordinate(current) - coordinate(previous));
                let mut intersection = Point {
                    x: previous.x + t * (current.x - previous.x),
                    y: previous.y + t * (current.y - previous.y),
                };
                if axis == 0 {
                    intersection.x = boundary;
                } else {
                    intersection.y = boundary;
                }
                scratch[next_count] = intersection;
                next_count += 1;
            }
            if current_inside {
                scratch[next_count] = current;
                next_count += 1;
            }
            previous = current;
            previous_inside = current_inside;
        }
        std::mem::swap(&mut points, &mut scratch);
        count = next_count;
    }
    let mut area = 0.0;
    for index in 0..count {
        let current = points[index];
        let next = points[(index + 1) % count];
        area += current.x * next.y - current.y * next.x;
    }
    (area.abs() * 0.5).clamp(0.0, 1.0)
}
