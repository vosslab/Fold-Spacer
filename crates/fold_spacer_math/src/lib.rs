//! Deterministic runner calculations shared by native tests and browser WebAssembly.

/// Advance along the protein course using seconds and course units per second.
#[unsafe(no_mangle)]
pub extern "C" fn advance_distance(distance: f32, speed: f32, delta_seconds: f32) -> f32 {
    distance + speed * delta_seconds.clamp(0.0, 0.05)
}

/// Return the horizontal world coordinate for lane -1, 0, or 1.
#[unsafe(no_mangle)]
pub extern "C" fn lane_target(lane: i32, lane_spacing: f32) -> f32 {
    lane.clamp(-1, 1) as f32 * lane_spacing
}

/// Smoothly approach a lane without frame-rate-dependent overshoot.
#[unsafe(no_mangle)]
pub extern "C" fn ease_toward(current: f32, target: f32, response: f32, delta_seconds: f32) -> f32 {
    let delta = delta_seconds.clamp(0.0, 0.05);
    let amount = 1.0 - (-response.max(0.0) * delta).exp();
    current + (target - current) * amount
}

/// Test a lane-local collision within a symmetric course-distance window.
#[unsafe(no_mangle)]
pub extern "C" fn runner_collision(
    player_lane_x: f32,
    object_lane_x: f32,
    player_distance: f32,
    object_distance: f32,
    lane_tolerance: f32,
    distance_tolerance: f32,
) -> u32 {
    let same_lane = (player_lane_x - object_lane_x).abs() <= lane_tolerance;
    let same_distance = (player_distance - object_distance).abs() <= distance_tolerance;
    u32::from(same_lane && same_distance)
}

/// Score a collected residue by secondary-structure class and current combo.
#[unsafe(no_mangle)]
pub extern "C" fn residue_score(structure_code: u32, combo: u32) -> u32 {
    let base = match structure_code {
        1 => 12,
        2 => 15,
        _ => 10,
    };
    let multiplier = 1 + combo.min(40) / 8;
    base * multiplier
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_step_and_lane_math_stay_stable() {
        assert!((advance_distance(10.0, 24.0, 0.025) - 10.6).abs() < 0.000_01);
        assert_eq!(lane_target(-1, 3.5), -3.5);
        assert_eq!(lane_target(4, 3.5), 3.5);
    }

    #[test]
    fn collision_requires_lane_and_distance_overlap() {
        assert_eq!(runner_collision(0.0, 0.1, 50.0, 50.5, 0.3, 1.0), 1);
        assert_eq!(runner_collision(0.0, 3.5, 50.0, 50.5, 0.3, 1.0), 0);
        assert_eq!(runner_collision(0.0, 0.1, 50.0, 52.0, 0.3, 1.0), 0);
    }

    #[test]
    fn residue_scoring_rewards_structure_and_combo() {
        assert_eq!(residue_score(0, 0), 10);
        assert_eq!(residue_score(1, 8), 24);
        assert_eq!(residue_score(2, 40), 90);
    }
}
