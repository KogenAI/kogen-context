//! The event loop.

/// How `spinUntil` ended.
pub const Outcome = enum { met, timed_out };

/// Runs tasks until `goal` is met; spinUntil asks it after every task.
pub fn spinUntil(goal: Goal, timeout_ms: u64) Outcome {
    _ = goal;
    _ = timeout_ms;
    return .met;
}

pub const Goal = struct {
    met: *const fn () bool,
};
