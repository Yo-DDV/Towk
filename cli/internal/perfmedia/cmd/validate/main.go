package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"hmans.de/chatto/internal/perfmedia"
)

type stabilityInput struct {
	Samples                 []perfmedia.CampaignSample `json:"samples"`
	MaximumDeviationPercent float64                    `json:"maximum_deviation_percent"`
}

type monitoringInput struct {
	MetricsOff     []perfmedia.MonitoringSample `json:"metrics_off"`
	MetricsOn      []perfmedia.MonitoringSample `json:"metrics_on"`
	MaximumPercent float64                      `json:"maximum_percent"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	return runWithOutput(args, os.Stdout)
}

type repeatedPaths []string

func (paths *repeatedPaths) String() string { return fmt.Sprint([]string(*paths)) }

func (paths *repeatedPaths) Set(value string) error {
	if value == "" {
		return errors.New("input path must not be empty")
	}
	*paths = append(*paths, value)
	return nil
}

func runWithOutput(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("towk-media-validate", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	kind := flags.String("kind", "", "validation kind: stability, delivery-stability, or monitoring")
	var inputPaths repeatedPaths
	flags.Var(&inputPaths, "input", "structured JSON input; repeat for delivery-stability")
	maximumDeviation := flags.Float64("maximum-deviation-percent", 10, "delivery stability maximum deviation")
	allowUnverified := flags.Bool("allow-unverified", false, "print a rejected assessment without returning an error")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("towk-media-validate does not accept positional arguments")
	}
	if len(inputPaths) == 0 {
		return errors.New("--input is required")
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	switch *kind {
	case "stability":
		if len(inputPaths) != 1 {
			return errors.New("stability validation requires exactly one --input")
		}
		input, err := openValidationInput(inputPaths[0])
		if err != nil {
			return err
		}
		defer input.Close()
		var request stabilityInput
		if err := decodeStrict(input, &request); err != nil {
			return err
		}
		assessment := perfmedia.AssessCampaignStability(request.Samples, request.MaximumDeviationPercent)
		if err := encoder.Encode(assessment); err != nil {
			return err
		}
		if !assessment.Canonical && !*allowUnverified {
			return fmt.Errorf("campaign stability is %s", assessment.Status)
		}
	case "delivery-stability":
		if len(inputPaths) < 3 {
			return errors.New("delivery-stability requires at least three independent --input results")
		}
		samples := make([]perfmedia.CampaignSample, 0, len(inputPaths))
		seenInputs := make(map[string]struct{}, len(inputPaths))
		seenRuns := make(map[string]struct{}, len(inputPaths))
		for index, path := range inputPaths {
			absolutePath, err := filepath.Abs(path)
			if err != nil {
				return err
			}
			if _, duplicate := seenInputs[absolutePath]; duplicate {
				return fmt.Errorf("delivery result %d repeats an input path", index+1)
			}
			seenInputs[absolutePath] = struct{}{}
			input, err := openValidationInput(path)
			if err != nil {
				return err
			}
			var result perfmedia.DeliveryCampaignResult
			decodeErr := decodeStrict(input, &result)
			closeErr := input.Close()
			if decodeErr != nil {
				return decodeErr
			}
			if closeErr != nil {
				return closeErr
			}
			if result.Status != "VERIFIED" || result.FailureCount != 0 || len(result.Reasons) != 0 || result.RequestCount <= 0 {
				return fmt.Errorf("delivery result %d is not VERIFIED", index+1)
			}
			if !perfmedia.ValidDeliveryRunID(result.RunID) {
				return fmt.Errorf("delivery result %d has an invalid run id", index+1)
			}
			if _, duplicate := seenRuns[result.RunID]; duplicate {
				return fmt.Errorf("delivery result %d repeats a campaign run id", index+1)
			}
			seenRuns[result.RunID] = struct{}{}
			samples = append(samples, result.Sample)
		}
		assessment := perfmedia.AssessCampaignStability(samples, *maximumDeviation)
		if err := encoder.Encode(assessment); err != nil {
			return err
		}
		if !assessment.Canonical && !*allowUnverified {
			return fmt.Errorf("delivery campaign stability is %s", assessment.Status)
		}
	case "monitoring":
		if len(inputPaths) != 1 {
			return errors.New("monitoring validation requires exactly one --input")
		}
		input, err := openValidationInput(inputPaths[0])
		if err != nil {
			return err
		}
		defer input.Close()
		var request monitoringInput
		if err := decodeStrict(input, &request); err != nil {
			return err
		}
		assessment := perfmedia.AssessMonitoringOverhead(request.MetricsOff, request.MetricsOn, request.MaximumPercent)
		if err := encoder.Encode(assessment); err != nil {
			return err
		}
		if !assessment.Accepted && !*allowUnverified {
			return fmt.Errorf("monitoring overhead is %s", assessment.Status)
		}
	default:
		return errors.New("--kind must be stability, delivery-stability, or monitoring")
	}
	return nil
}

func openValidationInput(path string) (*os.File, error) {
	input, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := input.Stat()
	if err != nil {
		input.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		input.Close()
		return nil, errors.New("validation input must be a regular file")
	}
	if info.Size() > 10<<20 {
		input.Close()
		return nil, errors.New("validation input exceeds 10 MiB")
	}
	return input, nil
}

func decodeStrict(input io.Reader, value any) error {
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("input contains more than one JSON value")
		}
		return err
	}
	return nil
}
