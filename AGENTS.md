# Working on reactc

- **Native, always.** Every app or example built here must compile and run
  natively. Never fall back to a JavaScript interpreter, and never replace
  unsupported behaviour with success-shaped mocks in client code. When
  something cannot be compiled, fail with a message that says so.
- **Real checks.** Prove compiler, runtime and library changes with real
  programs. Run `npm test`, `npm run test:compiler`, and the native checks
  that cover the change (see "Checks" in README.md), on Windows and Linux
  where the change applies. Report failures as they are; `cargo test` alone is
  not native acceptance.
- **Keep the docs in step.** When a limit is lifted or found, update
  docs/LIMITS.md.
- **Mocks stay in tests.** Keep mocked servers and synthetic data out of the
  compiled client bundles, and label them.
- **Toolchain.** `tools/` is installed by the scripts in `tools/` and
  `scripts/ci/install-tools.sh` (Ubuntu 26.04). Windows builds run that
  toolchain through WSL; the executables they produce do not need WSL.
