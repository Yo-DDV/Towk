package externalgif

import "testing"

func TestKlipyTrustedURLs(t *testing.T) {
	valid := []string{
		"https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif",
		"https://static.klipy.co/ii/3bbfac09dcb32c2b1e87ad063c4ac16e/9d/55/7VnHqCsL.webp",
	}
	for _, value := range valid {
		if !IsTrustedURL(value) {
			t.Fatalf("expected trusted URL: %s", value)
		}
	}

	invalid := []string{
		"https://static.klipy.com.evil.example/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/file.gif",
		"https://static.klipy.com/ii/not-a-hash/12/66/file.gif",
		"https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/1/66/file.gif",
		"https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/file.svg",
	}
	for _, value := range invalid {
		if IsTrustedURL(value) {
			t.Fatalf("expected rejected URL: %s", value)
		}
	}
}
