package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/nativepushinstance"
)

var nativeNotificationsConfigFile string

var nativeNotificationsCmd = &cobra.Command{
	Use:   "native-notifications",
	Short: "Manage native notification transports",
}

var nativeNotificationsEnrollCmd = &cobra.Command{
	Use:   "enroll",
	Short: "Enroll this public Towk instance with the managed FCM relay",
	Args:  cobra.NoArgs,
	RunE: func(*cobra.Command, []string) error {
		cfg, err := config.ReadConfig(nativeNotificationsConfigFile)
		if err != nil {
			return err
		}
		nativeConfig, err := config.LoadNativeNotificationsConfig()
		if err != nil {
			return err
		}
		if !nativeConfig.Enabled || !nativeConfig.AndroidManagedFCM {
			return fmt.Errorf("managed Android FCM notifications are not enabled")
		}
		identity, err := nativepushinstance.LoadOrCreateIdentity(nativeConfig.IdentityFile)
		if err != nil {
			return err
		}
		relay, err := nativepushinstance.NewRelayClient(nativeConfig.ManagedFCMRelayURL, nativeConfig.EnrollmentStateFile, identity, nil)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		state, err := relay.Enroll(ctx, cfg.Webserver.URL)
		if err != nil {
			return err
		}
		fmt.Fprintf(rootCmd.OutOrStdout(), "Enrolled instance %s with %s\n", state.InstanceID, state.RelayURL)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(nativeNotificationsCmd)
	nativeNotificationsCmd.AddCommand(nativeNotificationsEnrollCmd)
	nativeNotificationsEnrollCmd.Flags().StringVarP(&nativeNotificationsConfigFile, "config", "c", "", configFlagHelp)
}
