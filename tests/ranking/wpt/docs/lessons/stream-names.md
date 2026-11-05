# A chunk names its stream by its runner count

**Lesson**: a chunk with several runners writes journal.shard<k>.wptreport.jsonl.
**Why**: each runner streams beside its own journal.shard<k>.jsonl.
**What Happened**: a reader globbed journal.shard*.jsonl and missed one-runner chunks.
**Fix**: read both journal.jsonl and journal.shard*.jsonl.
**Takeaway**: journal.shard is the several-runner layout.
