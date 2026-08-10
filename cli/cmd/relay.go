package cmd

import (
	"context"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"

	"hmans.de/chatto/internal/nativepushrelay"
	"hmans.de/chatto/internal/runtimeunit"
)

var relayCmd = &cobra.Command{
	Use:   "relay",
	Short: "Run the managed Android FCM relay",
	Args:  cobra.NoArgs,
	Run: func(*cobra.Command, []string) {
		runRelay()
	},
}

func init() {
	rootCmd.AddCommand(relayCmd)
}

func runRelay() {
	listenAddress := envOrDefault("TOWK_RELAY_LISTEN_ADDR", "127.0.0.1:8095")
	stateFile := envOrDefault("TOWK_RELAY_STATE_FILE", "/var/lib/towk-relay/state.json")
	credentialsFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credentialsFile == "" {
		log.Fatal("GOOGLE_APPLICATION_CREDENTIALS is required")
	}
	credentials, err := os.ReadFile(credentialsFile)
	if err != nil {
		log.Fatal("Failed to read Firebase credentials", "error", err)
	}
	sender, err := nativepushrelay.NewFCMSender(credentials, nil)
	if err != nil {
		log.Fatal("Failed to configure Firebase sender", "error", err)
	}
	store, err := nativepushrelay.OpenStore(stateFile)
	if err != nil {
		log.Fatal("Failed to open relay state", "error", err)
	}
	relay, err := nativepushrelay.NewServer(store, sender)
	if err != nil {
		log.Fatal("Failed to configure relay", "error", err)
	}
	server := &http.Server{
		Addr:              listenAddress,
		Handler:           relay.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	ctx, stop := runtimeunit.NotifyContext(context.Background())
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Info("Starting managed FCM relay", "listen", listenAddress)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("Relay server failed", "error", err)
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
