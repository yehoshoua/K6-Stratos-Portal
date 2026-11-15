// Package mcpserver exposes a bounded, read-only adapter to the portal REST API.
package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxResponseBytes = 4 << 20

var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$`)

type API struct {
	base             *url.URL
	token, workspace string
	client           *http.Client
}

func NewAPI(baseURL, token, workspace string) (*API, error) {
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("STRATOS_URL must be an origin URL without credentials, path or query")
	}
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, fmt.Errorf("HTTPS is required except for a loopback portal")
	}
	if !strings.HasPrefix(token, "stratum_tok_") || strings.ContainsAny(token, "\r\n") {
		return nil, fmt.Errorf("a personal STRATOS_API_TOKEN is required")
	}
	if workspace != "" && !identifier.MatchString(workspace) {
		return nil, fmt.Errorf("invalid workspace")
	}
	return &API{base: u, token: token, workspace: workspace, client: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (a *API) get(ctx context.Context, path string, q url.Values, out any) (string, error) {
	u := *a.base
	u.Path = path
	u.RawPath = ""
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", fmt.Errorf("invalid API request")
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	if a.workspace != "" {
		req.Header.Set("X-Workspace-ID", a.workspace)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("portal unavailable or request timed out")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("portal returned HTTP %d; check token scopes and resource access", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return "", fmt.Errorf("failed to read portal response")
	}
	if len(raw) > maxResponseBytes {
		return "", fmt.Errorf("response too large; narrow the query")
	}
	if out != nil {
		if err = json.Unmarshal(raw, out); err != nil {
			return "", fmt.Errorf("invalid portal JSON response")
		}
	}
	return string(raw), nil
}
func checkID(name, value string) error {
	if !identifier.MatchString(value) || value == "." || value == ".." {
		return fmt.Errorf("invalid %s", name)
	}
	return nil
}
func checkTarget(cluster, namespace string) error {
	if err := checkID("cluster_id", cluster); err != nil {
		return err
	}
	if err := checkID("namespace", namespace); err != nil {
		return err
	}
	if namespace == "all" {
		return fmt.Errorf("a specific namespace is required")
	}
	return nil
}
