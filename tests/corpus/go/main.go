// Command rowreport prints a small report of rows.
package main

import (
	"fmt"
	"os"

	"example.com/rowreport/internal/report"
)

func main() {
	rows := report.Rows
	if len(os.Args) > 1 && os.Args[1] == "--short" {
		rows = rows[:5]
	}
	fmt.Println(report.Header())
	for _, row := range rows {
		// FormatRow pads every column to its fixed width.
		fmt.Println(report.FormatRow(row))
	}
	fmt.Printf("%d rows\n", len(rows))
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: rowreport [--short]")
	os.Exit(2)
}
