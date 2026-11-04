"""Fixed-width formatting of report rows."""

ID_WIDTH = 6
NAME_WIDTH = 12


def pad(text, width):
    """Cut or pad text to exactly width characters."""
    if len(text) >= width:
        return text[:width]
    return text + " " * (width - len(text))


def format_header():
    return pad("ID", ID_WIDTH) + " " + pad("NAME", NAME_WIDTH)


def format_row(row):
    """Render one (id, name) row with every column padded to its width."""
    row_id, name = row
    return pad(str(row_id), ID_WIDTH) + " " + pad(name, NAME_WIDTH)


def is_empty(row):
    return not row[1].strip()
