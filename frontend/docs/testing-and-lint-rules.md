# Testing And Lint Rules

## Goal

This project keeps production code linting strict while preventing test-only annotation churn from drowning out real quality signals.

The boundary for this phase is:

- keep production rules strict
- reduce low-value warning noise in tests
- make test discovery and test-support naming explicit

## File Classes

Production source files:

- `src/**/*.ts`
- `src/**/*.tsx`
- excluding `src/**/*.{spec,test}.{ts,tsx}`
- excluding `src/test-support/**/*.{ts,tsx}`

Direct source test entrypoints:

- `src/**/*.spec.ts`
- `src/**/*.spec.tsx`

Shared test-support modules:

- `src/**/*.test.ts`
- `src/**/*.test.tsx`
- `src/test-support/**/*.{ts,tsx}`

Root-level node test entrypoints:

- `tests/*.test.mjs`

## Lint Policy

Production source files keep the baseline rules:

- `@typescript-eslint/no-explicit-any`: `error`
- `@typescript-eslint/no-unused-vars`: `error`
- `prefer-const`: `error`
- `no-var`: `error`
- `@typescript-eslint/explicit-function-return-type`: `warn`

Test and test-support files intentionally relax only the rules that generate high annotation noise with low defect-detection value:

- `@typescript-eslint/explicit-function-return-type`: `off`
- `react-refresh/only-export-components`: `off`
- `no-console`: `off`

The relaxation is limited to test files. It does not apply to production source files.

## Why `explicit-function-return-type` Is Disabled In Tests

For this codebase, the main warning volume inside tests came from:

- inline `node:test` callbacks
- local mock factories
- tiny one-shot harness builders
- assertion-local helper lambdas

Those functions are short-lived, inference-friendly, and rarely form stable public contracts. Requiring explicit return types there created large amounts of repetitive boilerplate, but produced very little additional safety.

The same rule stays enabled for production code because exported helpers, reusable callbacks, and stateful runtime logic benefit from explicit contract pressure.

## Test Discovery Rules

The test runner distinguishes between runnable entrypoints and helper modules.

Runnable entrypoints:

- `src/**/*.spec.ts[x]`
- `tests/*.test.mjs`

Non-runnable helper modules:

- `src/**/*.test.ts[x]`

`src/**/*.test.ts[x]` files are compiled so that root test entrypoints can import them, but they are not executed directly by `scripts/run-tests.mjs`.

If `TEST_FILE` points at a `src/**/*.test.ts[x]` helper module, the runner now fails with a clear message instead of silently doing nothing.

## Action Priority

Use lint output with this priority order:

- `error`: merge blocker and required fix
- production `warning`: real quality debt or follow-up improvement
- test `warning`: should be rare; if a warning pattern becomes repetitive, prefer fixing the shared rule boundary instead of adding repetitive annotations

## Team Conventions

- Add explicit return types in tests only when the function shape is genuinely non-obvious.
- Do not add repetitive return-type annotations just to silence lint in test files.
- Do not weaken production rules to solve test noise.
- Prefer shared test helpers under `src/**/*.test.ts[x]` when multiple test entrypoints need the same harness logic.
