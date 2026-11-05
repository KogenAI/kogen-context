# The console waits for its whole life

**What Happened**: tools/repl.zig called spinUntil once per input line.
**Fix**: the console calls spinUntil once, with the exit goal.
