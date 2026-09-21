# Security Policy

If you discover a security issue, please do not open a public issue with exploit details.

Create a private report or contact the maintainer directly.

This application stores only local Pomodoro settings, history, and exported JSON data. It does not require accounts or cloud sync.

The Windows build does not register startup tasks, services, shell extensions, COM classes, or notification activators. Completion alerts use an in-app message and a local sound.

Release builds require Go 1.26.6 or newer. Run `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...` before release; the 1.2.0 build reports no reachable vulnerabilities. Windows Defender also reports no threats in the generated executable.

The executable contains version and product metadata. Public releases should additionally be signed with a trusted Authenticode code-signing certificate; a self-signed certificate does not establish publisher reputation with SmartScreen.
