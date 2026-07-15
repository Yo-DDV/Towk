package core

import (
	"bytes"
	"fmt"
	"io"
	"math"

	"google.golang.org/protobuf/proto"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	MinVoiceMessageDurationMS    int64 = 100
	MaxVoiceMessageDurationMS    int64 = 20 * 60 * 1000
	MaxVoiceMessageUploadSize    int64 = 32 * 1024 * 1024
	MinVoiceMessageWaveformPeaks       = 24
	MaxVoiceMessageWaveformPeaks       = 96
)

var allowedVoiceMessageContentTypes = map[string]struct{}{
	"audio/mp4":  {},
	"audio/ogg":  {},
	"audio/webm": {},
}

// VoiceMessageUploadMetadata is the JSON-safe upload-session representation
// of first-class voice-message metadata.
type VoiceMessageUploadMetadata struct {
	DurationMS    int64     `json:"duration_ms"`
	WaveformPeaks []float32 `json:"waveform_peaks"`
}

func validateVoiceMessageUpload(metadata *VoiceMessageUploadMetadata, contentType string, size int64) error {
	if metadata == nil {
		return nil
	}
	if _, ok := allowedVoiceMessageContentTypes[contentType]; !ok {
		return invalidArgument("voice messages require a supported audio content type")
	}
	if size <= 0 {
		return invalidArgument("voice messages must contain audio data")
	}
	if size > MaxVoiceMessageUploadSize {
		return invalidArgument(fmt.Sprintf("voice messages must not exceed %d bytes", MaxVoiceMessageUploadSize))
	}
	if metadata.DurationMS < MinVoiceMessageDurationMS || metadata.DurationMS > MaxVoiceMessageDurationMS {
		return invalidArgument(fmt.Sprintf("voice message duration must be between %d and %d milliseconds", MinVoiceMessageDurationMS, MaxVoiceMessageDurationMS))
	}
	if len(metadata.WaveformPeaks) < MinVoiceMessageWaveformPeaks || len(metadata.WaveformPeaks) > MaxVoiceMessageWaveformPeaks {
		return invalidArgument(fmt.Sprintf("voice message waveform must contain between %d and %d peaks", MinVoiceMessageWaveformPeaks, MaxVoiceMessageWaveformPeaks))
	}
	for _, peak := range metadata.WaveformPeaks {
		if math.IsNaN(float64(peak)) || math.IsInf(float64(peak), 0) || peak < 0 || peak > 1 {
			return invalidArgument("voice message waveform peaks must be finite values between 0 and 1")
		}
	}
	return nil
}

func voiceMessageMetadataProto(metadata *VoiceMessageUploadMetadata) *corev1.VoiceMessageMetadata {
	if metadata == nil {
		return nil
	}
	return &corev1.VoiceMessageMetadata{
		DurationMs:    metadata.DurationMS,
		WaveformPeaks: append([]float32(nil), metadata.WaveformPeaks...),
	}
}

func voiceMessageUploadMetadata(metadata *corev1.VoiceMessageMetadata) *VoiceMessageUploadMetadata {
	if metadata == nil {
		return nil
	}
	return &VoiceMessageUploadMetadata{
		DurationMS:    metadata.GetDurationMs(),
		WaveformPeaks: append([]float32(nil), metadata.GetWaveformPeaks()...),
	}
}

func cloneVoiceMessageMetadata(metadata *corev1.VoiceMessageMetadata) *corev1.VoiceMessageMetadata {
	if metadata == nil {
		return nil
	}
	return proto.Clone(metadata).(*corev1.VoiceMessageMetadata)
}

func validateVoiceMessageContainer(reader io.ReadSeeker, contentType string) error {
	header := make([]byte, 16)
	n, readErr := reader.Read(header)
	if readErr != nil && readErr != io.EOF {
		return fmt.Errorf("inspect voice message header: %w", readErr)
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind voice message after header inspection: %w", err)
	}
	header = header[:n]

	valid := false
	switch contentType {
	case "audio/webm":
		valid = bytes.HasPrefix(header, []byte{0x1a, 0x45, 0xdf, 0xa3})
	case "audio/ogg":
		valid = bytes.HasPrefix(header, []byte("OggS"))
	case "audio/mp4":
		valid = len(header) >= 8 && bytes.Equal(header[4:8], []byte("ftyp"))
	}
	if !valid {
		return invalidArgument("voice message content does not match its declared audio format")
	}
	return nil
}
