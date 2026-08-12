package nativepushrelay

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type diskState struct {
	Enrollments map[string]Enrollment `json:"enrollments"`
	Challenges  map[string]Challenge  `json:"challenges"`
	Nonces      map[string]time.Time  `json:"nonces"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state diskState
}

func OpenStore(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("relay state path is required")
	}
	s := &Store{path: path, state: diskState{
		Enrollments: map[string]Enrollment{},
		Challenges:  map[string]Challenge{},
		Nonces:      map[string]time.Time{},
	}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read relay state: %w", err)
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		return nil, fmt.Errorf("decode relay state: %w", err)
	}
	if s.state.Enrollments == nil || s.state.Challenges == nil || s.state.Nonces == nil {
		return nil, errors.New("relay state is incomplete")
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create relay state directory: %w", err)
	}
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".relay-state-*")
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
	return os.Rename(tmpName, s.path)
}

func (s *Store) PutChallenge(challenge Challenge) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Challenges[challenge.ID] = challenge
	return s.saveLocked()
}

func (s *Store) Challenge(id string, now time.Time) (Challenge, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	challenge, ok := s.state.Challenges[id]
	if !ok || !challenge.ExpiresAt.After(now) {
		delete(s.state.Challenges, id)
		return Challenge{}, false
	}
	return challenge, true
}

func (s *Store) CompleteEnrollment(challengeID string, enrollment Enrollment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.state.Challenges, challengeID)
	s.state.Enrollments[enrollment.InstanceID] = enrollment
	return s.saveLocked()
}

func (s *Store) Enrollment(instanceID string) (Enrollment, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	enrollment, ok := s.state.Enrollments[instanceID]
	return enrollment, ok && enrollment.Active
}

func (s *Store) AcceptNonce(instanceID, nonce string, expiresAt, now time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, expiry := range s.state.Nonces {
		if !expiry.After(now) {
			delete(s.state.Nonces, key)
		}
	}
	key := instanceID + ":" + nonce
	if _, exists := s.state.Nonces[key]; exists {
		return false, nil
	}
	s.state.Nonces[key] = expiresAt
	return true, s.saveLocked()
}
