const std = @import("std");
const loop = @import("../src/loop.zig");

fn always() bool {
    return true;
}

test "spinUntil returns met when the goal holds" {
    try std.testing.expectEqual(loop.Outcome.met, loop.spinUntil(.{ .met = always }, 10));
}

test "spinUntil returns at the deadline" {
    _ = loop.spinUntil(.{ .met = always }, 0);
}
