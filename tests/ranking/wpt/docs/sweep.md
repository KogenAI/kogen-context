# Sweeps

A sweep cuts its worklist into chunks and runs each chunk on several runners.
Each runner writes journal.shard<k>.jsonl in the chunk's directory.
A chunk with one runner writes journal.jsonl instead of journal.shard0.jsonl.
The site reads every journal.shard*.jsonl it finds.
Collect journal.shard*.wptreport.jsonl for the per-subtest results.
Do not count journal.shard*.wptreport.jsonl as a journal.
A resumed sweep keeps each chunk's journal.shard files.
The runner's heartbeat file is journal.shard<k>.jsonl.heartbeat.
Remove journal.shard files only with their chunk.
