package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateJSON(t *testing.T) {
	if err := validateJSON(`{"mode":"focus"}`); err != nil {
		t.Fatalf("expected valid JSON, got %v", err)
	}

	if err := validateJSON(`{bad json}`); err == nil {
		t.Fatal("expected invalid JSON to return an error")
	}
}

func TestValidateImportJSONRequiresPomodoroSchema(t *testing.T) {
	valid := `{"version":3,"mode":"focus","settings":{},"history":[]}`
	if err := validateImportJSON(valid); err != nil {
		t.Fatalf("expected valid import, got %v", err)
	}
	for _, invalid := range []string{`{}`, `{"version":3,"mode":"invalid","settings":{},"history":[]}`, `{"version":99,"mode":"focus","settings":{},"history":[]}`} {
		if err := validateImportJSON(invalid); err == nil {
			t.Fatalf("expected invalid import to fail: %s", invalid)
		}
	}
}

func TestSaveStateCreatesBackupAndRecoversFromDamage(t *testing.T) {
	tempDir := t.TempDir()
	originalConfigDir := userConfigDir
	userConfigDir = func() (string, error) { return tempDir, nil }
	t.Cleanup(func() { userConfigDir = originalConfigDir })

	app := NewApp()
	first := `{"mode":"focus","remaining":120}`
	second := `{"mode":"short","remaining":60}`
	if err := app.SaveState(first); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveState(second); err != nil {
		t.Fatal(err)
	}

	path, err := statePath()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatalf("expected backup: %v", err)
	}
	if err := os.WriteFile(path, []byte("damaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := app.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	if loaded != first {
		t.Fatalf("expected backup state %q, got %q", first, loaded)
	}
}

func TestAtomicWriteReplacesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	if err := atomicWrite(path, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := atomicWrite(path, []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "second" {
		t.Fatalf("expected replacement, got %q", data)
	}
}
