package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	mu       sync.Mutex
	quitting bool
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	startTray(a)
}

func (a *App) shutdown(context.Context) { stopTray() }

func (a *App) beforeClose(ctx context.Context) bool {
	if a.quitting || !traySupported() {
		return false
	}
	runtime.WindowHide(ctx)
	return true
}

var userConfigDir = os.UserConfigDir

func dataDir() (string, error) {
	base, err := userConfigDir()
	if err != nil || base == "" {
		base, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	dir := filepath.Join(base, "ApplePomodoro")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func statePath() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "state.json"), nil
}

func validateJSON(data string) error {
	if data == "" {
		return errors.New("empty state")
	}
	var tmp interface{}
	return json.Unmarshal([]byte(data), &tmp)
}

func validateImportJSON(data string) error {
	if err := validateJSON(data); err != nil {
		return err
	}
	var payload struct {
		Version  int               `json:"version"`
		Mode     string            `json:"mode"`
		Settings map[string]any    `json:"settings"`
		History  []json.RawMessage `json:"history"`
	}
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		return err
	}
	if payload.Version != 2 && payload.Version != 3 {
		return errors.New("unsupported or missing export version")
	}
	if payload.Mode != "focus" && payload.Mode != "short" && payload.Mode != "long" && payload.Mode != "stopwatch" {
		return errors.New("invalid timer mode")
	}
	if payload.Settings == nil {
		return errors.New("import settings are missing")
	}
	if payload.History == nil {
		return errors.New("import history is missing")
	}
	return nil
}

func (a *App) LoadState() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path, err := statePath()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if validateJSON(string(b)) != nil {
		backup, backupErr := os.ReadFile(path + ".bak")
		if backupErr != nil || validateJSON(string(backup)) != nil {
			return "", fmt.Errorf("saved state is damaged and no valid backup exists")
		}
		return string(backup), nil
	}
	return string(b), nil
}

func (a *App) SaveState(data string) error {
	if err := validateJSON(data); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	path, err := statePath()
	if err != nil {
		return err
	}
	if current, readErr := os.ReadFile(path); readErr == nil && validateJSON(string(current)) == nil {
		if err := atomicWrite(path+".bak", current, 0o600); err != nil {
			return fmt.Errorf("create state backup: %w", err)
		}
	}
	if err := atomicWrite(path, []byte(data), 0o600); err != nil {
		return fmt.Errorf("save state: %w", err)
	}
	return nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) (resultErr error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".pomodoro-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}()
	if err := tmp.Chmod(mode); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return replaceFile(tmpPath, path)
}

func (a *App) ResetState() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	path, err := statePath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Remove(path + ".bak"); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (a *App) ExportState(data string) (string, error) {
	if err := validateJSON(data); err != nil {
		return "", err
	}
	name := fmt.Sprintf("pomodoro-export-%s.json", time.Now().Format("2006-01-02-15-04-05"))
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Pomodoro data",
		DefaultFilename: name,
		Filters: []runtime.FileFilter{{
			DisplayName: "JSON files (*.json)",
			Pattern:     "*.json",
		}},
	})
	if err != nil || path == "" {
		return path, err
	}
	if err := atomicWrite(path, []byte(data), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ImportState() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Pomodoro data",
		Filters: []runtime.FileFilter{{
			DisplayName: "JSON files (*.json)",
			Pattern:     "*.json",
		}},
	})
	if err != nil || path == "" {
		return "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 5*1024*1024+1))
	if err != nil {
		return "", err
	}
	if len(data) > 5*1024*1024 {
		return "", errors.New("import file is larger than 5 MB")
	}
	if err := validateImportJSON(string(data)); err != nil {
		return "", fmt.Errorf("invalid import: %w", err)
	}
	return string(data), nil
}

func (a *App) SetAlwaysOnTop(enabled bool) {
	runtime.WindowSetAlwaysOnTop(a.ctx, enabled)
}

func (a *App) SetCompactMode(enabled, windowed bool) {
	if enabled {
		runtime.WindowUnmaximise(a.ctx)
		runtime.WindowSetMinSize(a.ctx, 360, 420)
		runtime.WindowSetSize(a.ctx, 420, 540)
		runtime.WindowCenter(a.ctx)
		return
	}
	runtime.WindowSetMinSize(a.ctx, 1180, 720)
	if windowed {
		runtime.WindowUnmaximise(a.ctx)
		runtime.WindowSetSize(a.ctx, 1200, 760)
		runtime.WindowCenter(a.ctx)
		return
	}
	runtime.WindowMaximise(a.ctx)
}

func (a *App) SetWindowedMode(enabled bool) {
	runtime.WindowSetMinSize(a.ctx, 1180, 720)
	if enabled {
		runtime.WindowUnmaximise(a.ctx)
		runtime.WindowSetSize(a.ctx, 1200, 760)
		runtime.WindowCenter(a.ctx)
		return
	}
	runtime.WindowMaximise(a.ctx)
}

func (a *App) Minimise() {
	runtime.WindowMinimise(a.ctx)
}

func (a *App) CloseWindow() {
	if traySupported() {
		runtime.WindowHide(a.ctx)
		return
	}
	a.Quit()
}

func (a *App) HideToTray() {
	if traySupported() {
		runtime.WindowHide(a.ctx)
		return
	}
	runtime.WindowMinimise(a.ctx)
}

func (a *App) ShowWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
}

func (a *App) RevealForAlert() {
	a.ShowWindow()
}

func (a *App) Quit() {
	a.quitting = true
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}
