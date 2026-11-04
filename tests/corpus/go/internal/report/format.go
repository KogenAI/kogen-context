// Package report formats rows as fixed-width text.
package report

import (
	"fmt"
	"strings"
)

const (
	idWidth   = 6
	nameWidth = 12
)

// Row is one line of the report.
type Row struct {
	ID   int
	Name string
}

// Header returns the title line of the report.
func Header() string {
	return pad("ID", idWidth) + " " + pad("NAME", nameWidth)
}

// FormatRow renders one row with every column padded to its width.
func FormatRow(row Row) string {
	return pad(fmt.Sprint(row.ID), idWidth) + " " + pad(row.Name, nameWidth)
}

// FormatRows renders the rows one per line.
func FormatRows(rows []Row) string {
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, FormatRow(row))
	}
	return strings.Join(lines, "\n")
}

func pad(s string, width int) string {
	if len(s) >= width {
		return s[:width]
	}
	return s + strings.Repeat(" ", width-len(s))
}

// Empty reports whether a row has no name.
func Empty(row Row) bool {
	return strings.TrimSpace(row.Name) == ""
}
