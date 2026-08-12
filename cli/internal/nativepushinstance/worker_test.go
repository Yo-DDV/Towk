package nativepushinstance

import (
	"bytes"
	"crypto/ecdh"
	"os"
	"path/filepath"
	"testing"
	"time"

	"filippo.io/hpke"

	"hmans.de/chatto/internal/core"
)

func TestWakeSignalHPKERoundTrip(t *testing.T) {
	privateKey, err := hpke.DHKEM(ecdh.P256()).GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	item := core.NativeNotificationOutboxItem{
		OutboxID:  "outbox-0123456789abcdef",
		Kind:      core.NativeNotificationKindCall,
		CreatedAt: time.Unix(100, 0),
		ExpiresAt: time.Unix(220, 0),
		Counter:   123456,
	}
	plaintext := encodeWakeSignal(item, "installation-0123456789abcdef")
	ciphertext, err := encryptWakeSignal(privateKey.PublicKey().Bytes(), plaintext)
	if err != nil {
		t.Fatal(err)
	}
	// filippo.io/hpke v0.4.0 single-use Open aliases and overwrites its input
	// (upstream issue #1). NewRecipient with a copied encapsulated key is the
	// RFC 9180 equivalent and also matches Android Tink's recipient behavior.
	enc := append([]byte(nil), ciphertext[:65]...)
	recipient, err := hpke.NewRecipient(enc, privateKey, hpke.HKDFSHA256(), hpke.AES256GCM(), []byte(hpkeContext))
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := recipient.Open(nil, ciphertext[65:])
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decrypted, plaintext) {
		t.Fatal("HPKE plaintext mismatch")
	}
	if !bytes.Contains(decrypted, []byte("\ncall\n100\n220\n123456\ninstallation-0123456789abcdef\n")) {
		t.Fatalf("unexpected wake signal: %q", decrypted)
	}
}

func TestIdentityFileIsPrivateAndStable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "identity.json")
	first, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreateIdentity(path)
	if err != nil {
		t.Fatal(err)
	}
	if first.PublicKeyString() != second.PublicKeyString() {
		t.Fatal("identity changed after reload")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("identity mode = %o", info.Mode().Perm())
	}
}
