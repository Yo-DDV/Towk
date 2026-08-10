package nativepushinstance

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (r *RelayClient) ProofHandler(baseURL string) http.Handler {
	baseURL = strings.TrimSuffix(baseURL, "/")
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		challenge := request.URL.Query().Get("challenge")
		if len(challenge) < 16 || len(challenge) > 128 || !safeChallenge(challenge) {
			http.Error(w, `{"error":"invalid_challenge"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(r.Proof(baseURL, challenge))
	})
}

func safeChallenge(value string) bool {
	for _, character := range value {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '_' || character == '-') {
			return false
		}
	}
	return true
}
