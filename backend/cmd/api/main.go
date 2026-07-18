package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/leader"
	"k6-bedrock-dashboard/backend/internal/server"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	dbDriver := cfg.DBType
	dbDSN := cfg.DBDSN

	if dbDSN == "" {
		dbPath := os.Getenv("DATABASE_PATH")
		if dbPath == "" {
			home, err := os.UserHomeDir()
			if err == nil {
				dbPath = filepath.Join(home, ".k6-bedrock-dashboard", "dashboard.db")
			} else {
				dbPath = "dashboard.db"
			}
		}
		dbDSN = dbPath
	}

	log.Printf("Initializing database driver %s at: %s", dbDriver, dbDSN)
	db, err := database.InitDB(dbDriver, dbDSN)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	if err := db.SeedK6PortalTemplates(); err != nil {
		log.Printf("Warning: failed to seed K6 portal templates: %v", err)
	}

	// Delete the mock EKS cluster if it exists in the database
	if err := db.DeleteCluster("eks-mock-us-west-2"); err != nil {
		log.Printf("Warning: failed to delete mock EKS cluster: %v", err)
	}

	srv := server.NewServer(cfg, db)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// The HTTP server itself is multi-active and always runs on every
	// replica — only the schedule runner underneath it is leader-gated
	// (see backend-ha-leader-election.mdc). Start it in the background so
	// leader election, which blocks, can run in the foreground.
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	httpServer := &http.Server{Addr: ":" + cfg.Port, Handler: srv.WithCORS(mux)}

	go func() {
		log.Printf("Server listening on port %s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	var stopLeaderWork func()
	leader.Run(ctx,
		func(leaderCtx context.Context) {
			stopLeaderWork = srv.RunAsLeader(leaderCtx)
		},
		func() {
			if stopLeaderWork != nil {
				stopLeaderWork()
			}
		},
	)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
