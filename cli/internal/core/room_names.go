package core

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/rivo/uniseg"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const roomNameEmojiJoiner = '\u200d'

var roomNameFold = cases.Fold()

// NormalizeRoomName produces the canonical display form persisted in room
// events. Names are NFC-normalized and Unicode space separators are collapsed
// to regular single spaces. Compound emoji may use U+200D, but other format
// characters and controls are rejected to keep names visible and unambiguous.
func NormalizeRoomName(name string) (string, error) {
	if !utf8.ValidString(name) {
		return "", fmt.Errorf("room name must be valid UTF-8")
	}

	trimmed := strings.TrimSpace(norm.NFC.String(name))
	if trimmed == "" {
		return "", fmt.Errorf("room name is required")
	}

	var normalized strings.Builder
	previousWasSpace := false
	hasVisibleBase := false
	for _, ch := range trimmed {
		switch {
		case unicode.Is(unicode.Cc, ch), unicode.Is(unicode.Zl, ch), unicode.Is(unicode.Zp, ch):
			return "", fmt.Errorf("room name cannot contain control characters")
		case unicode.Is(unicode.Cf, ch) && ch != roomNameEmojiJoiner:
			return "", fmt.Errorf("room name cannot contain invisible formatting characters")
		case unicode.Is(unicode.Zs, ch):
			if !previousWasSpace && normalized.Len() > 0 {
				normalized.WriteByte(' ')
			}
			previousWasSpace = true
		default:
			normalized.WriteRune(ch)
			previousWasSpace = false
			if !unicode.Is(unicode.M, ch) {
				hasVisibleBase = true
			}
		}
	}

	result := strings.TrimSpace(normalized.String())
	if result == "" || !hasVisibleBase || !HasVisibleContent(result) {
		return "", fmt.Errorf("room name is required")
	}
	graphemes := uniseg.NewGraphemes(result)
	for graphemes.Next() {
		cluster := graphemes.Str()
		if strings.ContainsRune(cluster, roomNameEmojiJoiner) && uniseg.StringWidth(cluster) != 2 {
			return "", fmt.Errorf("room name cannot contain invisible formatting characters")
		}
	}
	if utf8.RuneCountInString(result) > RoomNameMaxLength {
		return "", fmt.Errorf("room name must be %d characters or less", RoomNameMaxLength)
	}
	return result, nil
}

func roomNameKey(name string) string {
	canonical, err := NormalizeRoomName(name)
	if err != nil {
		// Existing event data predates this validator. Keep its lookup stable
		// instead of making the read model reject or hide a legacy room.
		canonical = strings.TrimSpace(norm.NFC.String(name))
	}
	return roomNameFold.String(canonical)
}
