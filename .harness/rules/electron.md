# Electron Rules

Read this rule before changing TypeScript, Electron, or package configuration, and
before reporting an Electron change complete.

## Engineering expectations

- Let `prettier` define formatting.
- Keep `strict` type checking on; do not silence it with `any` or `@ts-ignore`.
- Model "one of" values as discriminated unions and exhaust them with a `never`
  check so a new variant becomes a type error rather than a silent gap.
- Keep domain rules out of Electron's `main`, `preload`, and renderer layers so
  they stay testable without launching a window.
- Write only erasable TypeScript in packages that tests run directly: no `enum`,
  no `namespace`, no constructor parameter properties. Node strips types without
  transforming them, so non-erasable syntax fails at load. Use `const` unions and
  explicit field assignments instead.
- Use explicit `.ts` extensions in relative imports so the same source runs under
  `node --test` and compiles for Electron.
- Add unit or contract tests appropriate to changed behavior; run them with the
  built-in `node --test` runner.
- Do not invent a Node or Electron version floor while the project has not
  declared one.

## Verification gate

Run `bash .harness/scripts/verify-electron.sh` from the repository root after the
final change. It is the shared completion entrypoint and owns this exact
command sequence:

```bash
npm run format:check
npm run typecheck
npm test
```

Completion evidence is the fresh output from every applicable command. A failed or unavailable command is a reported verification gap, not a passing gate.
