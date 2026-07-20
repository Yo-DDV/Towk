package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"hmans.de/chatto/internal/perfmedia"
)

const (
	maximumWorkloadBytes = 1 << 20
	maximumBearerBytes   = 16 << 10
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("towk-media-delivery", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	inputPath := flags.String("input", "", "strict JSON delivery workload")
	outputPath := flags.String("output", "", "atomic redacted JSON result")
	bearerPath := flags.String("bearer-file", "", "optional private bearer-token file")
	allowUnverified := flags.Bool("allow-unverified", false, "write an UNVERIFIED result without returning an error")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("towk-media-delivery does not accept positional arguments")
	}
	if *inputPath == "" {
		return errors.New("--input is required")
	}

	var workload perfmedia.DeliveryWorkload
	if err := decodeStrictFile(*inputPath, maximumWorkloadBytes, &workload); err != nil {
		return fmt.Errorf("read delivery workload: %w", err)
	}
	bearerToken := ""
	if *bearerPath != "" {
		content, err := readBoundedPrivateFile(*bearerPath, maximumBearerBytes)
		if err != nil {
			return fmt.Errorf("read bearer credential: %w", err)
		}
		bearerToken = strings.TrimSpace(string(content))
		if bearerToken == "" {
			return errors.New("bearer credential is empty")
		}
	}

	result, err := perfmedia.RunDeliveryCampaign(ctx, nil, bearerToken, workload)
	if err != nil {
		return err
	}
	if *outputPath != "" {
		if err := writeJSONAtomic(*outputPath, result); err != nil {
			return err
		}
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		return fmt.Errorf("encode delivery result: %w", err)
	}
	if result.Status != "VERIFIED" && !*allowUnverified {
		return errors.New("media delivery campaign is UNVERIFIED; inspect the redacted reasons")
	}
	return nil
}

func decodeStrictFile(path string, maximumBytes int64, target any) error {
	content, err := readBoundedRegularFile(path, maximumBytes)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("JSON input must contain exactly one value")
	}
	return nil
}

func readBoundedRegularFile(path string, maximumBytes int64) ([]byte, error) {
	return readBoundedFile(path, maximumBytes, false)
}

func readBoundedPrivateFile(path string, maximumBytes int64) ([]byte, error) {
	return readBoundedFile(path, maximumBytes, true)
}

func readBoundedFile(path string, maximumBytes int64, requirePrivate bool) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("input must be a regular file")
	}
	if info.Size() > maximumBytes {
		return nil, fmt.Errorf("input exceeds %d bytes", maximumBytes)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !openedInfo.Mode().IsRegular() {
		return nil, errors.New("input must remain a regular file")
	}
	if !os.SameFile(info, openedInfo) {
		return nil, errors.New("input changed while it was being opened")
	}
	if requirePrivate && runtime.GOOS != "windows" && openedInfo.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("private input permissions must not allow group or other access")
	}
	content, err := io.ReadAll(io.LimitReader(file, maximumBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > maximumBytes {
		return nil, fmt.Errorf("input exceeds %d bytes", maximumBytes)
	}
	return content, nil
}

func writeJSONAtomic(path string, value any) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return fmt.Errorf("create delivery result directory: %w", err)
	}
	temp, err := os.CreateTemp(directory, ".towk-media-delivery-*.json")
	if err != nil {
		return fmt.Errorf("create delivery result: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return fmt.Errorf("secure delivery result: %w", err)
	}
	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		temp.Close()
		return fmt.Errorf("encode delivery result: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return fmt.Errorf("sync delivery result: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close delivery result: %w", err)
	}
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("publish delivery result: %w", err)
	}
	dir, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open delivery result directory: %w", err)
	}
	if err := dir.Sync(); err != nil {
		dir.Close()
		return fmt.Errorf("sync delivery result directory: %w", err)
	}
	if err := dir.Close(); err != nil {
		return fmt.Errorf("close delivery result directory: %w", err)
	}
	return nil
}
