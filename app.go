package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context)  { a.ctx = ctx }
func (a *App) shutdown(ctx context.Context) {}

func dataDir() (string, error) {
	base, err := os.UserConfigDir()
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

func (a *App) LoadState() (string, error) {
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
	return string(b), nil
}

func (a *App) SaveState(data string) error {
	if err := validateJSON(data); err != nil {
		return err
	}
	path, err := statePath()
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(data), 0o644)
}

func (a *App) ResetState() error {
	path, err := statePath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (a *App) ExportState(data string) (string, error) {
	if err := validateJSON(data); err != nil {
		return "", err
	}
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("pomodoro-export-%s.json", time.Now().Format("2006-01-02-15-04-05"))
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		return "", err
	}
	return path, nil
}
