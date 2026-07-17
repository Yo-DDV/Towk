package http_server

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type stableByteRange struct {
	start  int64
	length int64
}

type stableRangeResult uint8

const (
	stableRangeIgnored stableRangeResult = iota
	stableRangeSatisfiable
	stableRangeUnsatisfiable
)

func setStableAttachmentResponseHeaders(c *gin.Context, contentType, etag string) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	setOriginalAttachmentSecurityHeaders(c, contentType)
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", protectedAssetCacheControl)
	c.Header("ETag", etag)
	c.Header("Accept-Ranges", "bytes")
	c.Header("Vary", "Accept-Encoding, Authorization, Cookie")
}

func attachmentIfNoneMatch(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || candidate == etag || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}

func attachmentIfRangeMatches(header, etag string) bool {
	// Towk attachment validators are strong entity tags and do not expose a
	// Last-Modified validator. RFC 9110 requires exact strong comparison here;
	// weak tags and HTTP dates therefore fall back to the complete response.
	return header == "" || strings.TrimSpace(header) == etag
}

func parseStableByteRange(header string, size int64) (stableByteRange, stableRangeResult) {
	if header == "" || size < 0 || len(header) > 1024 || !strings.HasPrefix(header, "bytes=") {
		return stableByteRange{}, stableRangeIgnored
	}
	spec := strings.TrimSpace(strings.TrimPrefix(header, "bytes="))
	if spec == "" || strings.Contains(spec, ",") {
		return stableByteRange{}, stableRangeIgnored
	}
	firstText, lastText, ok := strings.Cut(spec, "-")
	if !ok || strings.Contains(lastText, "-") {
		return stableByteRange{}, stableRangeIgnored
	}

	if firstText == "" {
		suffix, err := strconv.ParseInt(lastText, 10, 64)
		if err != nil || suffix <= 0 {
			return stableByteRange{}, stableRangeIgnored
		}
		if size == 0 {
			return stableByteRange{}, stableRangeUnsatisfiable
		}
		if suffix > size {
			suffix = size
		}
		return stableByteRange{start: size - suffix, length: suffix}, stableRangeSatisfiable
	}

	first, err := strconv.ParseInt(firstText, 10, 64)
	if err != nil || first < 0 {
		return stableByteRange{}, stableRangeIgnored
	}
	if first >= size {
		return stableByteRange{}, stableRangeUnsatisfiable
	}
	last := size - 1
	if lastText != "" {
		last, err = strconv.ParseInt(lastText, 10, 64)
		if err != nil || last < first {
			return stableByteRange{}, stableRangeIgnored
		}
		if last >= size {
			last = size - 1
		}
	}
	return stableByteRange{start: first, length: last - first + 1}, stableRangeSatisfiable
}

func writeStableAttachmentBody(c *gin.Context, reader io.Reader, size int64, contentType, etag string) error {
	rangeHeader := c.GetHeader("Range")
	if !attachmentIfRangeMatches(c.GetHeader("If-Range"), etag) {
		rangeHeader = ""
	}
	requestedRange, result := parseStableByteRange(rangeHeader, size)
	switch result {
	case stableRangeUnsatisfiable:
		c.Header("Content-Range", fmt.Sprintf("bytes */%d", size))
		c.Header("Content-Length", "0")
		c.Status(http.StatusRequestedRangeNotSatisfiable)
		return nil
	case stableRangeSatisfiable:
		if requestedRange.start > 0 {
			if _, err := io.CopyN(io.Discard, reader, requestedRange.start); err != nil {
				return fmt.Errorf("skip to requested byte range: %w", err)
			}
		}
		end := requestedRange.start + requestedRange.length - 1
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", requestedRange.start, end, size))
		c.Header("Content-Length", strconv.FormatInt(requestedRange.length, 10))
		c.Status(http.StatusPartialContent)
		_, err := io.CopyN(c.Writer, reader, requestedRange.length)
		return err
	default:
		c.DataFromReader(http.StatusOK, size, contentType, reader, nil)
		return nil
	}
}
