//! The console: reads input, evaluates it, and keeps the event loop
//! running for the console's whole life (loop.spinUntil).

const std = @import("std");
const loop = @import("../src/loop.zig");

fn exitRequested() bool {
    return false;
}

pub fn main() void {
    // One wait for the console's whole life.
    _ = loop.spinUntil(.{ .met = exitRequested }, std.math.maxInt(u64));
}
