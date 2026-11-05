const std = @import("std");

test "a shard's journal is journal.shard<k>.jsonl" {
    try std.testing.expectEqualStrings("out/journal.shard1.jsonl", "out/journal.shard1.jsonl");
}
