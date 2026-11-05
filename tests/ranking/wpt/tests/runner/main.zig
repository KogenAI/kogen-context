//! The WPT runner: splits the worklist into shards and runs each on its own runner.

const std = @import("std");

pub fn runShards(allocator: std.mem.Allocator, dir: []const u8, shard_count: u32) !void {
    var i: u32 = 0;
    while (i < shard_count) : (i += 1) {
        // Each shard keeps its own journal (journal.shard<i>.jsonl).
        const jl = try std.fmt.allocPrint(allocator, "{s}/journal.shard{d}.jsonl", .{ dir, i });
        defer allocator.free(jl);
    }
}
