package server

import "k6-bedrock-dashboard/backend/internal/database"

type influxConfigResponse struct {
	*database.InfluxConfig
	HasToken    bool `json:"has_token"`
	HasPassword bool `json:"has_password"`
}

func publicInfluxConfig(c *database.InfluxConfig) influxConfigResponse {
	copy := *c
	copy.Token, copy.Password = "", ""
	return influxConfigResponse{&copy, c.Token != "", c.Password != ""}
}

func publicSSOConfig(c *database.SSOConfig) interface{} {
	copy := *c
	copy.ClientSecret = ""
	return struct {
		*database.SSOConfig
		HasClientSecret bool `json:"has_client_secret"`
	}{&copy, c.ClientSecret != ""}
}
