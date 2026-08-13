package linkpreview

import (
	"bytes"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

type fallbackMetadata struct {
	Title       string
	Description string
	SiteName    string
	ImageURL    string
}

const (
	maxFallbackTitleLength       = 300
	maxFallbackDescriptionLength = 1000
	maxFallbackSiteNameLength    = 200
)

func extractFallbackMetadata(document []byte, pageURL string) fallbackMetadata {
	root, err := html.Parse(bytes.NewReader(document))
	if err != nil {
		return fallbackMetadataForURL(pageURL)
	}

	metadata := fallbackMetadataForURL(pageURL)
	var htmlTitle string
	var standardDescription string
	var twitterTitle string
	var twitterDescription string
	var twitterImage string

	var editorialImage, pageImage, faviconImage string
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "title":
				if htmlTitle == "" && node.FirstChild != nil {
					htmlTitle = cleanMetadataText(node.FirstChild.Data)
				}
			case "link":
				rel := strings.ToLower(attribute(node, "rel"))
				if editorialImage == "" && strings.Contains(rel, "image_src") {
					editorialImage = attribute(node, "href")
				} else if faviconImage == "" && strings.Contains(rel, "icon") {
					faviconImage = attribute(node, "href")
				}
			case "img":
				candidate := firstNonEmpty(attribute(node, "src"), attribute(node, "data-src"))
				lowerCandidate := strings.ToLower(candidate)
				if pageImage == "" && candidate != "" &&
					!strings.Contains(lowerCandidate, "pixel") &&
					!strings.Contains(lowerCandidate, "spacer") &&
					!strings.Contains(lowerCandidate, "tracking") &&
					!strings.Contains(lowerCandidate, "avatar") &&
					!strings.Contains(lowerCandidate, "logo") &&
					!strings.Contains(lowerCandidate, "icon") {
					pageImage = candidate
				}
			case "meta":
				if editorialImage == "" && strings.EqualFold(attribute(node, "itemprop"), "image") {
					editorialImage = attribute(node, "content")
				}
				name := strings.ToLower(firstNonEmpty(attribute(node, "name"), attribute(node, "property")))
				content := cleanMetadataText(attribute(node, "content"))
				switch name {
				case "description":
					standardDescription = firstNonEmpty(standardDescription, content)
				case "application-name":
					metadata.SiteName = firstNonEmpty(content, metadata.SiteName)
				case "twitter:title":
					twitterTitle = firstNonEmpty(twitterTitle, content)
				case "twitter:description":
					twitterDescription = firstNonEmpty(twitterDescription, content)
				case "twitter:image", "twitter:image:src":
					twitterImage = firstNonEmpty(twitterImage, content)
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(root)

	metadata.Title = truncateMetadata(firstNonEmpty(twitterTitle, htmlTitle, metadata.Title), maxFallbackTitleLength)
	metadata.Description = truncateMetadata(firstNonEmpty(twitterDescription, standardDescription), maxFallbackDescriptionLength)
	metadata.SiteName = truncateMetadata(metadata.SiteName, maxFallbackSiteNameLength)
	metadata.ImageURL = resolveMetadataURL(
		pageURL,
		firstNonEmpty(twitterImage, editorialImage, pageImage, faviconImage, metadata.ImageURL),
	)
	return metadata
}

func fallbackMetadataForURL(rawURL string) fallbackMetadata {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fallbackMetadata{}
	}
	host := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
	faviconURL := (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: "/favicon.ico"}).String()
	return fallbackMetadata{Title: host, SiteName: host, ImageURL: faviconURL}
}

func resolveMetadataURL(pageURL, candidate string) string {
	if candidate == "" {
		return ""
	}
	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	reference, err := url.Parse(strings.TrimSpace(candidate))
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(reference)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}

func attribute(node *html.Node, name string) string {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, name) {
			return strings.TrimSpace(attr.Val)
		}
	}
	return ""
}

func cleanMetadataText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func truncateMetadata(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
