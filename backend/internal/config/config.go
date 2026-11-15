package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

type Config struct {
	Port          string
	EncryptionKey []byte
	JWTSecret     []byte
	InfluxURL     string
	InfluxToken   string
	InfluxOrg     string
	InfluxBucket  string
	DBType        string
	DBDSN         string

	// Guardian multi-agent validation runtime
	GuardianEnabled bool
	BedrockModelID  string
	AWSRegion       string
}

func LoadConfig() (*Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	production := strings.EqualFold(os.Getenv("APP_ENV"), "production")
	encKeyStr := os.Getenv("ENCRYPTION_KEY")
	if encKeyStr == "" && !production {
		encKeyStr = base64.StdEncoding.EncodeToString([]byte("dev-key-must-be-exactly-32bytes!"))
	}
	encKey, err := base64.StdEncoding.DecodeString(encKeyStr)
	if err != nil || len(encKey) != 32 {
		return nil, errors.New("ENCRYPTION_KEY must be a base64-encoded 32-byte key")
	}

	jwtSecretStr := os.Getenv("JWT_SECRET")
	if jwtSecretStr == "" {
		if production {
			return nil, errors.New("JWT_SECRET is required when APP_ENV=production")
		}
		jwtSecretStr = "super-secret-jwt-signing-key-for-k6-bedrock-dashboard"
	}
	if production && len(jwtSecretStr) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 bytes when APP_ENV=production")
	}

	dbType := os.Getenv("DB_TYPE")
	if dbType == "" {
		dbType = "sqlite"
	}
	dbDSN := os.Getenv("DATABASE_URL")

	guardianEnabled := true
	if v := os.Getenv("GUARDIAN_ENABLED"); v != "" {
		guardianEnabled = v != "false" && v != "0"
	}
	bedrockModelID := os.Getenv("BEDROCK_MODEL_ID")
	if bedrockModelID == "" {
		bedrockModelID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
	}

	return &Config{
		Port:            port,
		EncryptionKey:   encKey,
		JWTSecret:       []byte(jwtSecretStr),
		InfluxURL:       os.Getenv("INFLUXDB_URL"),
		InfluxToken:     os.Getenv("INFLUXDB_TOKEN"),
		InfluxOrg:       os.Getenv("INFLUXDB_ORG"),
		InfluxBucket:    os.Getenv("INFLUXDB_BUCKET"),
		DBType:          dbType,
		DBDSN:           dbDSN,
		GuardianEnabled: guardianEnabled,
		BedrockModelID:  bedrockModelID,
		AWSRegion:       os.Getenv("AWS_REGION"),
	}, nil
}

// Encrypt encrypts plain text using AES-256-GCM with the configured key
func (c *Config) Encrypt(plainText []byte) (string, error) {
	block, err := aes.NewCipher(c.EncryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	cipherText := gcm.Seal(nonce, nonce, plainText, nil)
	return base64.StdEncoding.EncodeToString(cipherText), nil
}

// Decrypt decrypts AES-256-GCM cipher text
func (c *Config) Decrypt(cipherTextStr string) ([]byte, error) {
	cipherText, err := base64.StdEncoding.DecodeString(cipherTextStr)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(c.EncryptionKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(cipherText) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, actualCipherText := cipherText[:nonceSize], cipherText[nonceSize:]
	plainText, err := gcm.Open(nil, nonce, actualCipherText, nil)
	if err != nil {
		return nil, err
	}

	return plainText, nil
}
