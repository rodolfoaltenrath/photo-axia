//! Experimental C1 pixel kernel. This is not the document-compositor ABI.
//! The caller owns the copied input buffer and must free it after use.

/// Matches the current TS fill-only pass on a transparent target. A source
/// pixel whose scaled alpha rounds to zero does not contribute hidden RGB.
pub fn apply_fill_opacity_in_place(rgba: &mut [u8], fill_opacity: u8) -> Result<(), &'static str> {
    if rgba.is_empty() || !rgba.len().is_multiple_of(4) {
        return Err("invalid-rgba-length");
    }
    if fill_opacity > 100 {
        return Err("invalid-fill-opacity");
    }

    let fill = f64::from(fill_opacity) / 100.0;
    for pixel in rgba.as_chunks_mut::<4>().0 {
        // JS Math.round rounds non-negative halves upward. Keep the same
        // sequence of floating-point operations as the existing TS pass.
        let alpha = (f64::from(pixel[3]) * fill + 0.5).floor() as u8;
        if alpha == 0 {
            pixel.fill(0);
        } else {
            pixel[3] = alpha;
        }
    }
    Ok(())
}

const MAX_POC_BYTES: usize = 64 * 1024 * 1024;

/// Allocates a byte buffer for the internal WASM adapter. A zero return means
/// failure. This experimental ABI must not be exposed to untrusted callers.
#[no_mangle]
pub extern "C" fn axia_poc_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return std::ptr::null_mut();
    }
    let layout = std::alloc::Layout::array::<u8>(len).expect("bounded RGBA length");
    unsafe { std::alloc::alloc_zeroed(layout) }
}

/// # Safety
/// `ptr` and `len` must be exactly the pair returned by `axia_poc_alloc`,
/// used only once. This precondition is enforced by the private JS adapter.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return;
    }
    let layout = std::alloc::Layout::array::<u8>(len).expect("bounded RGBA length");
    std::alloc::dealloc(ptr, layout);
}

/// Returns 0 on success, 1 for bad length, 2 for bad opacity, 3 for null ptr.
/// # Safety
/// `ptr` and `len` must identify a live allocation from `axia_poc_alloc`.
#[no_mangle]
pub unsafe extern "C" fn axia_poc_fill_opacity(ptr: *mut u8, len: usize, fill_opacity: u32) -> u32 {
    if ptr.is_null() {
        return 3;
    }
    if len == 0 || len > MAX_POC_BYTES || !len.is_multiple_of(4) {
        return 1;
    }
    if fill_opacity > 100 {
        return 2;
    }
    let rgba = std::slice::from_raw_parts_mut(ptr, len);
    match apply_fill_opacity_in_place(rgba, fill_opacity as u8) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_opacity_matches_the_existing_golden() {
        let mut rgba = [10, 20, 30, 101, 90, 80, 70, 255];
        apply_fill_opacity_in_place(&mut rgba, 50).unwrap();
        assert_eq!(rgba, [10, 20, 30, 51, 90, 80, 70, 128]);
    }

    #[test]
    fn transparent_rgb_does_not_leak() {
        let mut rgba = [200, 100, 50, 0, 40, 30, 20, 1];
        apply_fill_opacity_in_place(&mut rgba, 1).unwrap();
        assert_eq!(rgba, [0; 8]);
    }

    #[test]
    fn invalid_input_is_rejected_before_mutation() {
        let mut rgba = [10, 20, 30, 255];
        assert!(apply_fill_opacity_in_place(&mut rgba, 101).is_err());
        assert_eq!(rgba, [10, 20, 30, 255]);
        assert!(apply_fill_opacity_in_place(&mut rgba[..3], 50).is_err());
    }
}
