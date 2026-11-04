from app.report.format import format_header, format_row, is_empty


def test_format_row_pads_columns():
    assert format_row((7, "alpha")) == "7      alpha       "


def test_format_row_cuts_long_names():
    assert format_row((1, "a-name-that-is-too-long")) == "1      a-name-that-"


def test_header():
    assert format_header() == "ID     NAME        "


def test_is_empty():
    assert is_empty((1, "  "))
    assert not is_empty((1, "x"))
