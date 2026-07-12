package cmd

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/kms"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestEncryptDecryptKeysRoundTrip(t *testing.T) {
	keys := []ExportedKey{
		{KeyRef: "kek.alice", Key: []byte("01234567890123456789012345678901")}, // 32 bytes
		{UserID: "user-bob", Key: []byte("abcdefghijklmnopqrstuvwxyz012345")},  // legacy v2 shape
	}

	passphrase := "test-passphrase-123"
	tempFile := filepath.Join(t.TempDir(), "keys.age")

	// Encrypt to file
	if err := encryptKeysToFile(keys, passphrase, tempFile); err != nil {
		t.Fatal("encryptKeysToFile failed:", err)
	}

	// Verify the file starts with age header
	data, err := os.ReadFile(tempFile)
	if err != nil {
		t.Fatal("Failed to read encrypted file:", err)
	}
	if !strings.HasPrefix(string(data), "age-encryption.org/v1\n") {
		t.Error("Encrypted file does not start with age header")
	}

	// Decrypt with correct passphrase
	decrypted, err := decryptKeysFromFile(tempFile, passphrase)
	if err != nil {
		t.Fatal("decryptKeysFromFile failed:", err)
	}

	if len(decrypted) != len(keys) {
		t.Fatalf("Decrypted %d keys, want %d", len(decrypted), len(keys))
	}

	for i, dk := range decrypted {
		if dk.KeyRef != keys[i].KeyRef {
			t.Errorf("Key %d: KeyRef = %q, want %q", i, dk.KeyRef, keys[i].KeyRef)
		}
		if dk.UserID != keys[i].UserID {
			t.Errorf("Key %d: UserID = %q, want %q", i, dk.UserID, keys[i].UserID)
		}
		if string(dk.Key) != string(keys[i].Key) {
			t.Errorf("Key %d: key content mismatch", i)
		}
	}

	// Decrypt with wrong passphrase should fail
	_, err = decryptKeysFromFile(tempFile, "wrong-passphrase")
	if err == nil {
		t.Error("Expected decryption to fail with wrong passphrase")
	}
}

func TestEncryptKeysToFileReplacesSymlinkWithoutTouchingTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	dest := filepath.Join(dir, "keys.age")
	if err := os.WriteFile(target, []byte("do not overwrite"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, dest); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if err := encryptKeysToFile(nil, "test-passphrase", dest); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(target); err != nil || string(got) != "do not overwrite" {
		t.Fatalf("symlink target changed: data=%q err=%v", got, err)
	}
	info, err := os.Lstat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("destination mode = %v, want regular file", info.Mode())
	}
}

func TestEncryptKeysToFileRestrictsExistingDestination(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "keys.age")
	if err := os.WriteFile(dest, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := encryptKeysToFile(nil, "test-passphrase", dest); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("destination mode = %o, want 600", got)
	}
}

func TestKeysExportImportRoundTrip(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// --- Source server: create encryption keys ---

	_, _, srcJS := startTestNATS(t)

	srcKV, err := srcJS.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal("Failed to create ENCRYPTION_KEYS bucket:", err)
	}

	userKeyEncryptionKey, err := proto.Marshal(&corev1.UserKeyEncryptionKey{
		Key:       []byte("DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"),
		Algorithm: "builtin-xchacha20-poly1305-v1",
	})
	if err != nil {
		t.Fatal("marshal user key encryption key:", err)
	}

	testKeys := map[string][]byte{
		"user.alice":    []byte("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), // 32 bytes
		"user.bob":      []byte("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
		"user.charlie":  []byte("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"),
		"kek.DEKRef01":  userKeyEncryptionKey,
		"kek.LegacyRaw": []byte("RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR"),
	}

	for k, v := range testKeys {
		if _, err := srcKV.Put(ctx, k, v); err != nil {
			t.Fatalf("Failed to put key %s: %v", k, err)
		}
	}

	// --- Export keys ---

	selection, err := exportAllKeys(ctx, srcKV)
	if err != nil {
		t.Fatal("exportAllKeys failed:", err)
	}
	exported := selection.Keys
	if selection.SkippedWrappedDEKs != 0 || selection.SkippedCallKeys != 0 {
		t.Fatalf("unexpected skipped records: wrapped_deks=%d call_keys=%d", selection.SkippedWrappedDEKs, selection.SkippedCallKeys)
	}

	if len(exported) != len(testKeys) {
		t.Fatalf("Exported %d keys, want %d", len(exported), len(testKeys))
	}

	exportedByRef := make(map[string][]byte)
	exportedByUser := make(map[string][]byte)
	for _, ek := range exported {
		exportedByRef[ek.KeyRef] = ek.Key
		if ek.UserID != "" {
			exportedByUser[ek.UserID] = ek.Key
		}
	}

	for k, wantVal := range testKeys {
		got, ok := exportedByRef[k]
		if !ok {
			t.Errorf("Missing exported key ref %s", k)
			continue
		}
		if string(got) != string(wantVal) {
			t.Errorf("Key for %s: got %q, want %q", k, got, wantVal)
		}
	}
	if _, ok := exportedByUser["alice"]; !ok {
		t.Error("legacy user key should still populate user_id")
	}

	// --- Encrypt to file and decrypt ---

	passphrase := "test-passphrase"
	tempFile := filepath.Join(t.TempDir(), "keys.age")

	if err := encryptKeysToFile(exported, passphrase, tempFile); err != nil {
		t.Fatal("encryptKeysToFile failed:", err)
	}

	decrypted, err := decryptKeysFromFile(tempFile, passphrase)
	if err != nil {
		t.Fatal("decryptKeysFromFile failed:", err)
	}

	// --- Import into a fresh NATS server ---

	_, _, dstJS := startTestNATS(t)

	dstKV, err := dstJS.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal("Failed to create destination ENCRYPTION_KEYS bucket:", err)
	}
	imported, skippedExisting, skippedWrappedDEKs, err := importKeys(ctx, dstKV, decrypted)
	if err != nil {
		t.Fatal("importKeys failed:", err)
	}

	if imported != len(testKeys) {
		t.Errorf("Imported %d keys, want %d", imported, len(testKeys))
	}
	if skippedExisting != 0 {
		t.Errorf("Skipped existing %d keys, want 0", skippedExisting)
	}
	if skippedWrappedDEKs != 0 {
		t.Errorf("Skipped wrapped DEKs %d, want 0", skippedWrappedDEKs)
	}

	// --- Verify: keys survived the round-trip ---

	for k, wantVal := range testKeys {
		entry, err := dstKV.Get(ctx, k)
		if err != nil {
			t.Fatalf("Failed to get key %s from destination: %v", k, err)
		}
		if string(entry.Value()) != string(wantVal) {
			t.Errorf("Key %s: got %q, want %q", k, string(entry.Value()), string(wantVal))
		}
	}

	// --- Verify: importing again skips existing keys ---

	for _, key := range decrypted {
		if _, err := dstKV.Create(ctx, keyRefForImport(key), key.Key); err == nil {
			t.Errorf("Expected key %s to already exist on second import", keyRefForImport(key))
		}
	}
}

func TestKeyRefForImport_LegacyV2UserID(t *testing.T) {
	got := keyRefForImport(ExportedKey{UserID: "alice"})
	if got != "user.alice" {
		t.Fatalf("keyRefForImport legacy = %q, want user.alice", got)
	}
}

func TestImportKeysRejectsInvalidExportBeforeWriting(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, js := startTestNATS(t)
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal("Failed to create ENCRYPTION_KEYS bucket:", err)
	}

	valid := ExportedKey{KeyRef: "kek.valid", Key: []byte("VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV")}
	invalid := ExportedKey{KeyRef: "other.bad", Key: []byte("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")}
	imported, skippedExisting, skippedWrappedDEKs, err := importKeys(ctx, kv, []ExportedKey{valid, invalid})
	if err == nil {
		t.Fatal("importKeys should reject unknown prefixes")
	}
	if imported != 0 || skippedExisting != 0 || skippedWrappedDEKs != 0 {
		t.Fatalf("importKeys imported=%d skipped_existing=%d skipped_wrapped_deks=%d, want 0/0/0", imported, skippedExisting, skippedWrappedDEKs)
	}
	if _, err := kv.Get(ctx, "kek.valid"); err == nil {
		t.Fatal("valid key was written despite later invalid export record")
	}
}

func TestImportKeysSkipsWrappedDEKExportsWithoutBlockingKEKs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, js := startTestNATS(t)
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal("Failed to create ENCRYPTION_KEYS bucket:", err)
	}

	wrappedDEK, err := proto.Marshal(&corev1.UserDataEncryptionKey{
		EncryptedContentKey: []byte("wrapped"),
		ContentKeyNonce:     []byte("nonce"),
		WrappingAlgorithm:   kms.AlgorithmBuiltinXChaCha20Poly1305V1,
		WrappingKeyRef:      "kek.valid",
	})
	if err != nil {
		t.Fatal("marshal wrapped DEK:", err)
	}

	keys := []ExportedKey{
		{KeyRef: "kek.valid", Key: []byte("VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV")},
		{KeyRef: "dek.old", Key: wrappedDEK},
	}
	imported, skippedExisting, skippedWrappedDEKs, err := importKeys(ctx, kv, keys)
	if err != nil {
		t.Fatal("importKeys failed:", err)
	}
	if imported != 1 || skippedExisting != 0 || skippedWrappedDEKs != 1 {
		t.Fatalf("importKeys imported=%d skipped_existing=%d skipped_wrapped_deks=%d, want 1/0/1", imported, skippedExisting, skippedWrappedDEKs)
	}
	if _, err := kv.Get(ctx, "kek.valid"); err != nil {
		t.Fatalf("expected KEK to import: %v", err)
	}
	if _, err := kv.Get(ctx, "dek.old"); err == nil {
		t.Fatal("wrapped DEK should not be imported into ENCRYPTION_KEYS")
	}
}

func TestImportKeysRejectsMalformedKnownRecords(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, js := startTestNATS(t)
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal("Failed to create ENCRYPTION_KEYS bucket:", err)
	}

	malformedDEK, err := proto.Marshal(&corev1.UserDataEncryptionKey{
		EncryptedContentKey: []byte("wrapped"),
		WrappingAlgorithm:   kms.AlgorithmBuiltinXChaCha20Poly1305V1,
		WrappingKeyRef:      "kek.valid",
	})
	if err != nil {
		t.Fatal("marshal malformed DEK:", err)
	}
	for _, test := range []ExportedKey{
		{KeyRef: "kek.bad", Key: []byte("short")},
		{KeyRef: "user.bad", Key: []byte("short")},
	} {
		imported, skippedExisting, skippedWrappedDEKs, err := importKeys(ctx, kv, []ExportedKey{test})
		if err == nil {
			t.Fatalf("importKeys should reject malformed record %s", keyRefForImport(test))
		}
		if imported != 0 || skippedExisting != 0 || skippedWrappedDEKs != 0 {
			t.Fatalf("importKeys imported=%d skipped_existing=%d skipped_wrapped_deks=%d, want 0/0/0", imported, skippedExisting, skippedWrappedDEKs)
		}
	}
	imported, skippedExisting, skippedWrappedDEKs, err := importKeys(ctx, kv, []ExportedKey{{KeyRef: "dek.bad", Key: malformedDEK}})
	if err != nil {
		t.Fatalf("wrapped DEK export should be skipped before validation: %v", err)
	}
	if imported != 0 || skippedExisting != 0 || skippedWrappedDEKs != 1 {
		t.Fatalf("wrapped DEK import imported=%d skipped_existing=%d skipped_wrapped_deks=%d, want 0/0/1", imported, skippedExisting, skippedWrappedDEKs)
	}
}

func TestExportAllKeysRejectsInvalidBucketRecords(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, js := startTestNATS(t)
	for _, test := range []struct {
		name string
		ref  string
		data []byte
	}{
		{name: "unknown prefix", ref: "other.bad", data: []byte("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")},
		{name: "malformed kek", ref: "kek.bad", data: []byte("short")},
		{name: "malformed user", ref: "user.bad", data: []byte("short")},
	} {
		t.Run(test.name, func(t *testing.T) {
			kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
				Bucket:  "ENCRYPTION_KEYS_" + strings.ReplaceAll(test.name, " ", "_"),
				Storage: jetstream.FileStorage,
			})
			if err != nil {
				t.Fatal("Failed to create ENCRYPTION_KEYS bucket:", err)
			}
			if _, err := kv.Put(ctx, test.ref, test.data); err != nil {
				t.Fatal("Failed to put key:", err)
			}
			if _, err := exportAllKeys(ctx, kv); err == nil {
				t.Fatal("exportAllKeys should reject invalid bucket record")
			}
		})
	}
}

func TestExportAllKeysSkipsNonKEKRecordsWithoutBlockingKEKs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, js := startTestNATS(t)
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket:  "ENCRYPTION_KEYS_MIXED",
		Storage: jetstream.FileStorage,
	})
	if err != nil {
		t.Fatal(err)
	}
	records := map[string][]byte{
		"kek.valid":        []byte("VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV"),
		"dek.legacy":       []byte("legacy wrapped DEK"),
		"call.e2ee.active": []byte("short-lived call key"),
	}
	for ref, data := range records {
		if _, err := kv.Put(ctx, ref, data); err != nil {
			t.Fatal(err)
		}
	}

	selection, err := exportAllKeys(ctx, kv)
	if err != nil {
		t.Fatal(err)
	}
	if len(selection.Keys) != 1 || selection.Keys[0].KeyRef != "kek.valid" {
		t.Fatalf("exported keys = %#v, want only kek.valid", selection.Keys)
	}
	if selection.SkippedWrappedDEKs != 1 || selection.SkippedCallKeys != 1 {
		t.Fatalf("skipped wrapped_deks=%d call_keys=%d, want 1/1", selection.SkippedWrappedDEKs, selection.SkippedCallKeys)
	}
}
