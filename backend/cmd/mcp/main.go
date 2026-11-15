// stratos-mcp is a local stdio MCP server. Stdout is reserved for MCP messages.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"k6-bedrock-dashboard/backend/internal/mcpserver"
)

func main() {
	log.SetOutput(os.Stderr)
	base := os.Getenv("STRATOS_URL")
	if base == "" {
		base = "http://127.0.0.1:8080"
	}
	token := os.Getenv("STRATOS_API_TOKEN")
	if file := os.Getenv("STRATOS_TOKEN_FILE"); file != "" {
		info, err := os.Stat(file)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
			log.Fatal("STRATOS_TOKEN_FILE must be a regular file readable only by its owner (chmod 600)")
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			log.Fatal("unable to read STRATOS_TOKEN_FILE")
		}
		token = strings.TrimSpace(string(raw))
	}
	api, err := mcpserver.NewAPI(base, token, os.Getenv("STRATOS_WORKSPACE_ID"))
	if err != nil {
		log.Fatal(err)
	}
	if err := mcpserver.NewServer(api).Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintln(os.Stderr, "MCP session ended:", err)
		os.Exit(1)
	}
}
