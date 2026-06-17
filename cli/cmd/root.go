package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Version is set by main package at startup
var Version = "dev"

var rootCmd = &cobra.Command{
	Use:     "chatto",
	Version: Version,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// SetVersion sets the version for the CLI
func SetVersion(v string) {
	Version = v
	rootCmd.Version = v
}
