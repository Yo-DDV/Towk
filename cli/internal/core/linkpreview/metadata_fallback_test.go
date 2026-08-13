package linkpreview

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractFallbackMetadataPrefersTwitterThenHTML(t *testing.T) {
	document := []byte(`<!doctype html><html><head>
		<title>HTML title</title>
		<meta name="description" content="Standard description">
		<meta name="application-name" content="Example App">
		<meta name="twitter:title" content="Twitter title">
		<meta name="twitter:description" content="Twitter description">
		<meta name="twitter:image" content="/social-card.png">
	</head></html>`)

	metadata := extractFallbackMetadata(document, "https://www.example.com/articles/1")

	require.Equal(t, "Twitter title", metadata.Title)
	require.Equal(t, "Twitter description", metadata.Description)
	require.Equal(t, "Example App", metadata.SiteName)
	require.Equal(t, "https://www.example.com/social-card.png", metadata.ImageURL)
}

func TestExtractFallbackMetadataAcceptsTwitterPropertyMarkup(t *testing.T) {
	metadata := extractFallbackMetadata(
		[]byte(`<html><head><meta property="twitter:title" content="Property title"><meta property="twitter:image" content="/card.png"></head></html>`),
		"https://example.com/article",
	)

	require.Equal(t, "Property title", metadata.Title)
	require.Equal(t, "https://example.com/card.png", metadata.ImageURL)
}

func TestExtractFallbackMetadataBoundsUntrustedText(t *testing.T) {
	metadata := extractFallbackMetadata(
		[]byte(`<html><head><title>`+strings.Repeat("é", 400)+`</title><meta name="description" content="`+strings.Repeat("d", 1200)+`"></head></html>`),
		"https://example.com",
	)

	require.Len(t, []rune(metadata.Title), maxFallbackTitleLength)
	require.Len(t, []rune(metadata.Description), maxFallbackDescriptionLength)
}

func TestExtractFallbackMetadataUsesDomainForSparsePages(t *testing.T) {
	document := []byte(`<!doctype html><html><head></head></html>`)

	metadata := extractFallbackMetadata(document, "https://www.example.com/articles/1")

	require.Equal(t, "example.com", metadata.Title)
	require.Equal(t, "example.com", metadata.SiteName)
	require.Empty(t, metadata.ImageURL)
}

func TestResolveMetadataURLRejectsActiveSchemes(t *testing.T) {
	require.Empty(t, resolveMetadataURL("https://example.com", "javascript:alert(1)"))
	require.Empty(t, resolveMetadataURL("https://example.com", "data:image/png;base64,abc"))
}
