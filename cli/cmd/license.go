package cmd

import (
	_ "embed"
	"fmt"

	"github.com/spf13/cobra"
)

// LICENSE is synchronized from the AGPL license text before builds.
//
//go:embed embedded/LICENSE
var licenseText string

// NOTICE is synchronized from the root NOTICE before builds.
//
//go:embed embedded/NOTICE
var noticeText string

// ApacheLicense is synchronized for the embedded web client bundled with Towk.
//
//go:embed embedded/Apache-2.0
var apacheLicenseText string

var licenseCmd = &cobra.Command{
	Use:   "license",
	Short: "Print license information",
	Run: func(cmd *cobra.Command, args []string) {
		out := cmd.OutOrStdout()
		fmt.Fprint(out, licenseText)
		fmt.Fprint(out, "\n\n")
		fmt.Fprint(out, apacheLicenseText)
		fmt.Fprint(out, "\n\n")
		fmt.Fprint(out, noticeText)
	},
}

func init() {
	rootCmd.AddCommand(licenseCmd)
}
