package nativepushinstance

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type identityFile struct {
	Version    int    `json:"version"`
	SigningKey string `json:"private_key"`
}

type Identity struct {
	signingKey ed25519.PrivateKey
}

func LoadOrCreateIdentity(path string) (*Identity, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		_, privateKey, generationErr := ed25519.GenerateKey(rand.Reader)
		if generationErr != nil {
			return nil, generationErr
		}
		if err := writePrivateJSON(path, identityFile{Version: 1, SigningKey: base64.RawURLEncoding.EncodeToString(privateKey)}); err != nil {
			return nil, err
		}
		return &Identity{signingKey: privateKey}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read native notification identity: %w", err)
	}
	var stored identityFile
	if err := json.Unmarshal(data, &stored); err != nil || stored.Version != 1 {
		return nil, errors.New("invalid native notification identity")
	}
	privateKey, err := base64.RawURLEncoding.DecodeString(stored.SigningKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid native notification private key")
	}
	return &Identity{signingKey: ed25519.PrivateKey(privateKey)}, nil
}

func (i *Identity) PublicKeyString() string {
	return base64.RawURLEncoding.EncodeToString(i.signingKey.Public().(ed25519.PublicKey))
}

func (i *Identity) Sign(message []byte) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(i.signingKey, message))
}

func writePrivateJSON(path string, value any) error {
	if !filepath.IsAbs(path) {
		return errors.New("private state path must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".towk-private-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
