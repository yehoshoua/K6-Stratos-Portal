package server

import (
	"sync"
	"time"
)

// ttlCache is a tiny generic, thread-safe cache with per-entry
// expiration. It exists to avoid re-querying the Kubernetes API (server
// version discovery, k6-operator CRD presence, namespace lists) on every
// single dashboard poll — those values change on the order of minutes,
// not seconds, so a short TTL cuts a meaningful amount of load off both
// this backend and every target EKS API server without risking stale
// data for more than a few seconds.
type ttlCache[T any] struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]ttlEntry[T]
}

type ttlEntry[T any] struct {
	value     T
	expiresAt time.Time
}

func newTTLCache[T any](ttl time.Duration) *ttlCache[T] {
	return &ttlCache[T]{ttl: ttl, entries: make(map[string]ttlEntry[T])}
}

func (c *ttlCache[T]) get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expiresAt) {
		var zero T
		return zero, false
	}
	return entry.value, true
}

func (c *ttlCache[T]) set(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = ttlEntry[T]{value: value, expiresAt: time.Now().Add(c.ttl)}
}

// getOrCompute returns the cached value for key if present and fresh,
// otherwise calls compute, caches, and returns its result.
func (c *ttlCache[T]) getOrCompute(key string, compute func() T) T {
	if v, ok := c.get(key); ok {
		return v
	}
	v := compute()
	c.set(key, v)
	return v
}
