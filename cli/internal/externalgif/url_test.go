package externalgif

import (
	"os"
	"strings"
	"testing"
)

func TestIsTrustedURL(t *testing.T) {
	t.Parallel()

	valid := []string{
		"https://giphy.com/gifs/reaction-happy-l0MYt5jPR6QX5pnqM",
		"https://giphy.com/gifs/reaction-happy-l0MYt5jPR6QX5pnqM/",
		"https://www.giphy.com/stickers/wave-3o7TKsQ8UQ4l4LhGz6",
		"HTTPS://GIPHY.com/embed/l0MYt5jPR6QX5pnqM/",
		"https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif?cid=test",
		"https://media0.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif",
		"https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp",
		"https://i.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://i.giphy.com/l0MYt5jPR6QX5pnqM.mp4",
		"https://media.tenor.com/2wdlar795ZAAAAAd",
		"https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif",
		"https://media1.tenor.com/images/1169d1ab96669e13062c1b23ce5b9b01/tenor.gif?itemid=123",
		"https://media.tenor.com/images/36dfe91d9753a9e45a9ed316b83db346/tenor.webp",
		"https://media.tenor.com/AbCdEfGhIjK/tenor.gif",
		"https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4",
		"https://c.tenor.com/AbCdEfGhIjK/tenor.webp",
		"https://media.tenor.com/m/AbCdEfGhIjK/reaction-video.webm",
	}
	for _, rawURL := range valid {
		rawURL := rawURL
		t.Run("valid/"+rawURL, func(t *testing.T) {
			t.Parallel()
			if !IsTrustedURL(rawURL) {
				t.Fatalf("IsTrustedURL(%q) = false, want true", rawURL)
			}
		})
	}

	invalid := []string{
		"http://giphy.com/gifs/test-l0MYt5jPR6QX5pnqM",
		"https://user@giphy.com/gifs/test-l0MYt5jPR6QX5pnqM",
		"https://giphy.com:444/gifs/test-l0MYt5jPR6QX5pnqM",
		"https://giphy.com:443/embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com:/embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com:0443/embed/l0MYt5jPR6QX5pnqM",
		"https://@giphy.com/embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com/embed/l0MYt5jPR6QX5pnqM\n",
		"https://giphy.com/embed/l0MYt5jPR6QX5pnqM?label=réaction",
		"https://giphy.com.evil.example/gifs/test-l0MYt5jPR6QX5pnqM",
		"https://evil.example/media/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media5.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media999.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media.giphy.com/media/%2Fetc/giphy.gif",
		"https://media.giphy.com/media/%6c0MYt5jPR6QX5pnqM/giphy.gif",
		"https://giphy.com/%2e/embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com/%2e%2e/gifs/reaction-l0MYt5jPR6QX5pnqM",
		"https://giphy.com/gifs/%2e%2e/embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com/./embed/l0MYt5jPR6QX5pnqM",
		"https://giphy.com/gifs/../embed/l0MYt5jPR6QX5pnqM",
		"https://media.giphy.com/media/./l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media.giphy.com/media/v1/../l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media.giphy.com/media/l0MYt5jPR6QX5pnqM//giphy.gif",
		"https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif/",
		"https://media.giphy.com/media/short/giphy.gif",
		"https://media.giphy.com/media/v1..bad/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://media.giphy.com/media/" + strings.Repeat("a", 257) + "/l0MYt5jPR6QX5pnqM/giphy.gif",
		"https://i.giphy.com/path/l0MYt5jPR6QX5pnqM.gif",
		"https://i.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif/",
		"https://giphy.com/embed/l0MYt5jPR6QX5pnqM//",
		"https://giphy.com/embed/l0MYt5jPR6QX5pnqM/extra",
		"https://giphy.com/gifs/reaction-%2el0MYt5jPR6QX5pnqM",
		"https://media2.tenor.com/AbCdEfGhIjK/tenor.gif",
		"https://media1.tenor.com/images/not-a-hex-identifier-000000000000/tenor.gif",
		"https://media1.tenor.com/images/1169d1ab96669e13062c1b23ce5b9b0/tenor.gif",
		"https://media1.tenor.com/images/1169d1ab96669e13062c1b23ce5b9b01/tenor.svg",
		"https://media1.tenor.com/images/1169d1ab96669e13062c1b23ce5b9b01/variant/tenor.gif",
		"https://media.tenor.com/a/tenor.gif",
		"https://media.tenor.com/AbCdEfGhIjK/.gif",
		"https://media.tenor.com/AbCdEfGhIjK/a..b.gif",
		"https://media.tenor.com/AbCdEfGhIjK/reaction.svg",
		"https://media.tenor.com/m/AbCdEfGhIjK/too/many/segments/tenor.gif",
		"https://media.tenor.com/m/AbCdEfGhIjK/variant-with-more-than-thirty-two-characters/tenor.gif",
		"https://media.tenor.com/AbCdEfGhIjK/tenor.gif/",
		"https://media.tenor.com/AbCdEfGhIjK//tenor.gif",
		"https://media.tenor.com/./AbCdEfGhIjK/tenor.gif",
		"https://media.tenor.com/AbCdEfGhIjK/../AbCdEfGhIjK/tenor.gif",
		"https://tenor.com/view/reaction-gif-123456",
		"https://example.com/reaction.gif",
		`https://giphy.com\@evil.example/embed/l0MYt5jPR6QX5pnqM`,
		"https://giphy.com/embed/l0MYt5jPR6QX5pnqM?" + strings.Repeat("a", 2048),
		" javascript:alert(1)",
		"javascript:alert(1)",
	}
	for _, rawURL := range invalid {
		rawURL := rawURL
		t.Run("invalid/"+rawURL, func(t *testing.T) {
			t.Parallel()
			if IsTrustedURL(rawURL) {
				t.Fatalf("IsTrustedURL(%q) = true, want false", rawURL)
			}
		})
	}
}

func TestEnabled(t *testing.T) {
	for _, tt := range []struct {
		name  string
		value *string
		want  bool
	}{
		{name: "unset defaults on", want: true},
		{name: "empty defaults on", value: stringPtr(""), want: true},
		{name: "true", value: stringPtr("true"), want: true},
		{name: "false", value: stringPtr("false"), want: false},
		{name: "invalid fails closed", value: stringPtr("sometimes"), want: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if tt.value == nil {
				t.Setenv(EnabledEnvironmentVariable, "")
				if err := os.Unsetenv(EnabledEnvironmentVariable); err != nil {
					t.Fatal(err)
				}
			} else {
				t.Setenv(EnabledEnvironmentVariable, *tt.value)
			}
			if got := Enabled(); got != tt.want {
				t.Fatalf("Enabled() = %v, want %v", got, tt.want)
			}
		})
	}
}

func stringPtr(value string) *string { return &value }
