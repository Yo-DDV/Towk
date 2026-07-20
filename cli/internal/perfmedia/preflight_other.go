//go:build !linux

package perfmedia

import (
	"fmt"
	"runtime"
)

func capturePlatformPreflight(_ string, _ int) (PreflightSnapshot, error) {
	return PreflightSnapshot{
		OS: runtime.GOOS, Architecture: runtime.GOARCH, LogicalCPUs: runtime.NumCPU(),
	}, fmt.Errorf("canonical media performance preflight is supported only on Linux")
}
