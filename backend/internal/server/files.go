package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.Header.Get("X-Workspace-ID")
	if workspaceID == "" {
		workspaceID = "default"
	}

	// Limit multipart form size to 1MB (ConfigMap limit check)
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		http.Error(w, `{"error":"file exceeds 1MB limit"}`, http.StatusBadRequest)
		return
	}

	file, handler, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"failed to parse uploaded file"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	uploadDir := filepath.Join("data", "uploads", workspaceID)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create uploads directory: %v"}`, err), http.StatusInternalServerError)
		return
	}

	fileName := filepath.Base(handler.Filename)
	dstPath := filepath.Join(uploadDir, fileName)

	dst, err := os.Create(dstPath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to save file: %v"}`, err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to write file to disk: %v"}`, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":   "uploaded",
		"filename": fileName,
		"path":     dstPath,
	})
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.Header.Get("X-Workspace-ID")
	if workspaceID == "" {
		workspaceID = "default"
	}

	uploadDir := filepath.Join("data", "uploads", workspaceID)
	_ = os.MkdirAll(uploadDir, 0755)

	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to read files: %v"}`, err), http.StatusInternalServerError)
		return
	}

	files := make([]map[string]any, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, map[string]any{
			"filename":    entry.Name(),
			"size_bytes":  info.Size(),
			"uploaded_at": info.ModTime(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.Header.Get("X-Workspace-ID")
	if workspaceID == "" {
		workspaceID = "default"
	}

	filename := r.PathValue("filename")
	if filename == "" {
		http.Error(w, `{"error":"filename is required"}`, http.StatusBadRequest)
		return
	}

	targetPath := filepath.Join("data", "uploads", workspaceID, filepath.Base(filename))
	if err := os.Remove(targetPath); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
		} else {
			http.Error(w, fmt.Sprintf(`{"error":"failed to delete file: %v"}`, err), http.StatusInternalServerError)
		}
		return
	}

	w.Write([]byte(`{"status":"deleted"}`))
}
