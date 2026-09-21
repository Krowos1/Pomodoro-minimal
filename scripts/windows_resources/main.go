package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/tc-hib/winres"
	"github.com/tc-hib/winres/version"
	"golang.org/x/sys/windows"
)

const appVersion = "1.2.0.0"

func main() {
	if len(os.Args) != 2 {
		fatal(fmt.Errorf("usage: windows_resources <executable>"))
	}
	executable, err := filepath.Abs(os.Args[1])
	if err != nil {
		fatal(err)
	}
	if filepath.Ext(executable) != ".exe" {
		fatal(fmt.Errorf("refusing to patch a non-executable file: %s", executable))
	}

	projectRoot, err := findProjectRoot()
	if err != nil {
		fatal(err)
	}
	resourceSet := winres.ResourceSet{}

	iconFile, err := os.Open(filepath.Join(projectRoot, "build", "appicon.ico"))
	if err != nil {
		fatal(err)
	}
	defer iconFile.Close()
	icon, err := winres.LoadICO(iconFile)
	if err != nil {
		fatal(err)
	}
	if err := resourceSet.SetIcon(winres.RT_ICON, icon); err != nil {
		fatal(err)
	}

	info := version.Info{}
	info.SetFileVersion(appVersion)
	info.SetProductVersion(appVersion)
	values := map[string]string{
		version.CompanyName:      "Dmitro",
		version.FileDescription:  "Pomodoro Minimal",
		version.FileVersion:      appVersion,
		version.InternalName:     "Pomodoro-Minimal",
		version.LegalCopyright:   "Copyright 2026 Dmitro",
		version.OriginalFilename: "Pomodoro-Minimal.exe",
		version.ProductName:      "Pomodoro Minimal",
		version.ProductVersion:   appVersion,
		version.Comments:         "Pomodoro focus timer",
	}
	for key, value := range values {
		if err := info.Set(version.LangDefault, key, value); err != nil {
			fatal(err)
		}
	}
	resourceSet.SetVersionInfo(info)
	resourceSet.SetManifest(winres.AppManifest{
		Identity: winres.AssemblyIdentity{
			Name:    "com.dmitro.PomodoroMinimal",
			Version: [4]uint16{1, 2, 0, 0},
		},
		Description:         "Pomodoro Minimal",
		Compatibility:       winres.Win7AndAbove,
		ExecutionLevel:      winres.AsInvoker,
		DPIAwareness:        winres.DPIPerMonitorV2,
		LongPathAware:       true,
		UseCommonControlsV6: true,
	})

	source, err := os.Open(executable)
	if err != nil {
		fatal(err)
	}

	temporary, err := os.CreateTemp(filepath.Dir(executable), ".pomodoro-resources-*.exe")
	if err != nil {
		source.Close()
		fatal(err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if err := resourceSet.WriteToEXE(temporary, source, winres.ForceCheckSum()); err != nil {
		temporary.Close()
		source.Close()
		fatal(err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		source.Close()
		fatal(err)
	}
	if err := temporary.Close(); err != nil {
		source.Close()
		fatal(err)
	}
	if err := source.Close(); err != nil {
		fatal(err)
	}

	from, err := windows.UTF16PtrFromString(temporaryPath)
	if err != nil {
		fatal(err)
	}
	to, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		fatal(err)
	}
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		fatal(err)
	}
	fmt.Printf("Embedded icon and version metadata into %s\n", executable)
}

func findProjectRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "wails.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate wails.json")
		}
		dir = parent
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
