package database

import (
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"
)

//go:embed seed/k6-portal-templates/*.json
var k6PortalTemplateSeed embed.FS

type portalTemplateSeedFile struct {
	Name                   string `json:"name"`
	TemplateType           string `json:"template_type"`
	Parallelism            int    `json:"parallelism"`
	ScriptName             string `json:"script_name"`
	ScriptFile             string `json:"script_file"`
	RunnerImage            string `json:"runner_image"`
	CPULimit               string `json:"cpu_limit"`
	MemLimit               string `json:"mem_limit"`
	ScriptContent          string `json:"script_content"`
	ScheduleCronExpression string `json:"schedule_cron_expression"`
}

// SeedK6PortalTemplates inserts bundled xk6 templates when no template with the same name exists.
func (db *DB) SeedK6PortalTemplates() error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	existing, err := db.GetTemplates()
	if err != nil {
		return fmt.Errorf("list templates: %w", err)
	}

	// Deduplicate existing templates by name (case-insensitive)
	byNameLower := make(map[string][]*K6Template)
	for _, t := range existing {
		if t != nil {
			key := strings.ToLower(strings.TrimSpace(t.Name))
			byNameLower[key] = append(byNameLower[key], t)
		}
	}

	var deduplicatedCount int
	for name, templates := range byNameLower {
		if len(templates) > 1 {
			log.Printf("Deduplicating template '%s' (%d duplicates found)", name, len(templates))
			// Decide which one to keep:
			// 1. Prefer one with schedule enabled
			// 2. Prefer one with tmpl-seed- ID
			// 3. Prefer the oldest created_at
			bestIdx := 0
			for i := 1; i < len(templates); i++ {
				currBest := templates[bestIdx]
				challenger := templates[i]

				if challenger.ScheduleEnabled && !currBest.ScheduleEnabled {
					bestIdx = i
					continue
				}
				if currBest.ScheduleEnabled && !challenger.ScheduleEnabled {
					continue
				}

				currIsSeed := strings.HasPrefix(currBest.ID, "tmpl-seed-")
				chalIsSeed := strings.HasPrefix(challenger.ID, "tmpl-seed-")
				if chalIsSeed && !currIsSeed {
					bestIdx = i
					continue
				}
				if currIsSeed && !chalIsSeed {
					continue
				}

				if challenger.CreatedAt.Before(currBest.CreatedAt) {
					bestIdx = i
				}
			}

			// Delete duplicates
			for i, t := range templates {
				if i != bestIdx {
					log.Printf("Deleting duplicate template ID: %s (name: %s)", t.ID, t.Name)
					if err := db.DeleteTemplate(t.ID); err != nil {
						log.Printf("Warning: failed to delete duplicate template %s: %v", t.ID, err)
					} else {
						deduplicatedCount++
					}
				}
			}
		}
	}

	if deduplicatedCount > 0 {
		log.Printf("Cleaned up %d duplicate templates from database", deduplicatedCount)
		// Refresh existing templates list after deduplication
		existing, err = db.GetTemplates()
		if err != nil {
			return fmt.Errorf("list templates after deduplication: %w", err)
		}
	}

	byName := make(map[string]struct{}, len(existing))
	for _, t := range existing {
		if t != nil {
			byName[strings.ToLower(strings.TrimSpace(t.Name))] = struct{}{}
		}
	}

	entries, err := k6PortalTemplateSeed.ReadDir("seed/k6-portal-templates")
	if err != nil {
		return fmt.Errorf("read seed dir: %w", err)
	}

	var inserted int
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := k6PortalTemplateSeed.ReadFile(filepath.Join("seed/k6-portal-templates", entry.Name()))
		if err != nil {
			return fmt.Errorf("read %s: %w", entry.Name(), err)
		}

		var seed portalTemplateSeedFile
		if err := json.Unmarshal(raw, &seed); err != nil {
			return fmt.Errorf("parse %s: %w", entry.Name(), err)
		}
		if strings.TrimSpace(seed.Name) == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(seed.Name))
		if _, ok := byName[key]; ok {
			continue
		}

		t := &K6Template{
			ID:            fmt.Sprintf("tmpl-seed-%s", seed.Name),
			Name:          seed.Name,
			TemplateType:  seed.TemplateType,
			Parallelism:   seed.Parallelism,
			ScriptName:    seed.ScriptName,
			ScriptFile:    seed.ScriptFile,
			RunnerImage:   seed.RunnerImage,
			CPULimit:      seed.CPULimit,
			MemLimit:      seed.MemLimit,
			ScriptContent: seed.ScriptContent,
			CreatedAt:     time.Now().UTC(),
		}
		if seed.ScheduleCronExpression != "" {
			t.ScheduleCronExpression = seed.ScheduleCronExpression
		}

		if err := db.SaveTemplate(t); err != nil {
			return fmt.Errorf("save %s: %w", seed.Name, err)
		}
		byName[key] = struct{}{}
		inserted++
	}

	if inserted > 0 {
		log.Printf("Seeded %d K6 portal template(s) from bundle", inserted)
	}
	return nil
}
