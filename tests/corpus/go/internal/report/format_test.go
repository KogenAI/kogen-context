package report

import "testing"

func TestFormatRowPadsColumns(t *testing.T) {
	got := FormatRow(Row{ID: 7, Name: "alpha"})
	want := "7      alpha       "
	if got != want {
		t.Errorf("FormatRow = %q, want %q", got, want)
	}
}

func TestFormatRowCutsLongNames(t *testing.T) {
	got := FormatRow(Row{ID: 1, Name: "a-name-that-is-too-long"})
	want := "1      a-name-that-"
	if got != want {
		t.Errorf("FormatRow = %q, want %q", got, want)
	}
}

func TestFormatRowsJoinsLines(t *testing.T) {
	rows := []Row{{ID: 1, Name: "a"}, {ID: 2, Name: "b"}}
	got := FormatRows(rows)
	want := FormatRow(rows[0]) + "\n" + FormatRow(rows[1])
	if got != want {
		t.Errorf("FormatRows = %q, want %q", got, want)
	}
}

func TestHeader(t *testing.T) {
	if got := Header(); got != "ID     NAME        " {
		t.Errorf("Header = %q", got)
	}
}

func TestEmpty(t *testing.T) {
	if !Empty(Row{ID: 1, Name: "  "}) {
		t.Error("a blank name must be empty")
	}
	if Empty(Row{ID: 1, Name: "x"}) {
		t.Error("a named row must not be empty")
	}
}
