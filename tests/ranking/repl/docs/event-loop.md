# Event loop

`spinUntil` runs tasks until its goal is met or its deadline passes.

- spinUntil never returns before the goal is met or the deadline passes.
- The goal given to spinUntil is asked after every task.
- Tests call spinUntil with a short deadline.
