# Change Log

## [0.0.16]

- Support Golang dot imports ([#20](https://github.com/babakks/vscode-go-test-suite/issues/20) thanks to [tigarmo](https://github.com/tigarmo))

## [0.0.14]

- Allow cancellation of test runs ([#17](https://github.com/babakks/vscode-go-test-suite/issues/17) thanks to [SimonRichardson](https://github.com/SimonRichardson))
- Add code lens to copy test function launch configuration.

## [0.0.13]

- Use connection string instead of instrumentation key for telemetry.

## [0.0.12]

- Support running an entire test suite from the sidebar ([#13](https://github.com/babakks/vscode-go-test-suite/issues/13) thanks to [SimonRichardson](https://github.com/SimonRichardson)).

## [0.0.11]

- Support test suite functions that omit receiver variable name ([#12](https://github.com/babakks/vscode-go-test-suite/issues/12) thanks to [SimonRichardson](https://github.com/SimonRichardson)).

## [0.0.10]

- Apply environment variables set by `go.testEnvVar` configuration parameter.

## [0.0.9]

- Fix `qtsuite` run/debug command args.

## [0.0.8]

- Fix bug in not releasing allocated resources.

## [0.0.7]

- Fix issues with paths on Windows ([#4](https://github.com/babakks/vscode-go-test-suite/issues/4) thanks to [SpruceMarcy](https://github.com/SpruceMarcy)).
- Enable Go-debugger `logDest` option only on Linux or Mac ([#4](https://github.com/babakks/vscode-go-test-suite/issues/4) thanks to [SpruceMarcy](https://github.com/SpruceMarcy)).

## [0.0.6]

- Fix cluttered stdout/stderr stream of test runs when debugging.

## [0.0.5]

- Add Code Lens commands, appearing above test functions.
- Fix cluttered stdout/stderr stream of test runs.
- Fix bug in measuring time durations.
- Discover tests at startup.

## [0.0.4]

- (gocheck) Fix issue with filtering exact test names.

## [0.0.3]

- Add basic telemetry.

## [0.0.2]

- Add support for `quicktest` and `qtsuite`.

## [0.0.1]

- Add support for `go-check`.