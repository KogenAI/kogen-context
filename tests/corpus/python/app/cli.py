"""Command line entry point."""

import sys

from app.data.fixtures import ROWS
from app.report.format import format_header, format_row


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    rows = ROWS[:5] if "--short" in argv else ROWS
    print(format_header())
    for row in rows:
        print(format_row(row))
    print(f"{len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
