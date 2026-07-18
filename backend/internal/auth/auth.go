package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.MapClaims
}

type AuthService struct {
	jwtSecret []byte
	db        *database.DB
}

func NewAuthService(jwtSecret []byte, db *database.DB) *AuthService {
	return &AuthService{jwtSecret: jwtSecret, db: db}
}

// bcryptCost is deliberately the library default rather than a custom
// value: raising it "for security" without load-testing the login
// endpoint under real concurrency is a common source of accidental
// self-inflicted denial of service.
const bcryptCost = bcrypt.DefaultCost

// HashPassword hashes a password with bcrypt. The returned hash embeds
// its own random salt, so no separate salt value needs to be stored or
// passed back in for verification.
//
// Older rows created before this fix store a legacy `SHA256(password +
// salt)` hash instead (still gated behind the Salt column being
// non-empty and PasswordHash not looking like a bcrypt hash) — see
// verifyPassword below for the transparent migration path.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// GenerateSalt creates a cryptographically secure random salt string.
// Retained only so already-existing legacy (pre-bcrypt) rows keep
// validating until they are transparently rehashed on next login; new
// users no longer need a separately stored salt.
func GenerateSalt() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// legacySHA256Hash reproduces the pre-fix hashing scheme so existing
// database rows keep working through the migration window.
func legacySHA256Hash(password, salt string) string {
	hasher := sha256.New()
	hasher.Write([]byte(password + salt))
	return hex.EncodeToString(hasher.Sum(nil))
}

// isBcryptHash is a cheap structural check ($2a$/$2b$/$2y$ prefix) used
// to decide which verification path to take without a DB schema flag.
func isBcryptHash(hash string) bool {
	return strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$")
}

// verifyPassword checks password against the stored hash, transparently
// rehashing legacy SHA-256 rows to bcrypt in place on a successful login
// so the weak hash never has to be manually rotated fleet-wide.
func (s *AuthService) verifyPassword(user *database.User, password string) bool {
	if isBcryptHash(user.PasswordHash) {
		return bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) == nil
	}

	if legacySHA256Hash(password, user.Salt) != user.PasswordHash {
		return false
	}

	// Correct legacy password: migrate to bcrypt now, on the one occasion
	// we have the plaintext in hand.
	if newHash, err := HashPassword(password); err == nil && s.db != nil {
		user.PasswordHash = newHash
		user.Salt = ""
		_ = s.db.SaveUser(user)
	}
	return true
}

// LoginLocal validates local username/password against the database and
// returns a JWT token and user role if valid.
func (s *AuthService) LoginLocal(username, password string) (string, string, error) {
	if s.db == nil {
		return "", "", errors.New("database not initialized")
	}

	user, err := s.db.GetUser(username)
	if err != nil {
		return "", "", err
	}
	if user == nil {
		return "", "", errors.New("invalid credentials")
	}

	if !s.verifyPassword(user, password) {
		return "", "", errors.New("invalid credentials")
	}

	token, err := s.GenerateToken(user.Username, user.Role)
	if err != nil {
		return "", "", err
	}

	return token, user.Role, nil
}

// GenerateToken generates a JWT token valid for 24 hours
func (s *AuthService) GenerateToken(username, role string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": username,
		"role":     role,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	})

	tokenString, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

// ValidateToken parses and validates a JWT token
func (s *AuthService) ValidateToken(tokenStr string) (string, string, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return "", "", fmt.Errorf("invalid token: %w", err)
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		username, _ := claims["username"].(string)
		role, _ := claims["role"].(string)
		return username, role, nil
	}

	return "", "", errors.New("invalid claims")
}

// HandleSSOCallback is a legacy, unauthenticated demo/dev-only shortcut
// (POST /api/auth/sso) that predates the real OIDC authorization-code
// flow at /api/auth/sso/{url,callback}. It intentionally no longer maps
// any user to an elevated role from their username or email: the
// previous implementation granted "administrator" to any name or email
// that merely *contained* the substring "admin" (e.g. "radmin.jones"),
// which is a privilege-escalation bug, not a feature. Real role
// assignment must come from exact, configured Azure AD group claims via
// the OIDC callback (see handleSSOCallbackExchange in the server
// package), or from an administrator explicitly setting a user's role.
func (s *AuthService) HandleSSOCallback(ssoUser string, email string) (string, string, error) {
	const role = "viewer"
	token, err := s.GenerateToken(ssoUser, role)
	if err != nil {
		return "", "", err
	}
	return token, role, nil
}
