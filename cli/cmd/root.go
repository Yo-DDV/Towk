package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Version is set by main package at startup
var Version = "dev"

var rootCmd = &cobra.Command{
	Use:           "towk",
	Short:         "Run and manage a Towk server",
	Long:          rootBanner(Version),
	Version:       Version,
	SilenceUsage:  true,
	SilenceErrors: true,
}

const configFlagHelp = "path to configuration file (default: towk.toml)"

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
	rootCmd.Long = rootBanner(v)
}

func rootBanner(version string) string {
	return fmt.Sprintf(`Towk is a self-hosted communication workspace for teams and communities.
Version: %s | Project: https://github.com/Yo-DDV/towk`, version)
}
