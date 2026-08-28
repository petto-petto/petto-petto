# Shared Electron Harness

This is the common instruction entrypoint for Claude Code and Codex. Keep project instructions here; `CLAUDE.md` imports this file and runtime adapters only point to canonical Skills.

## Choose the relevant guidance

- Before changing TypeScript, Electron, or package configuration, or evaluating completion, read `.harness/rules/electron.md`.
- Before creating or changing a Skill or harness document, read `.harness/references/writing-great-skills/SKILL.md` and `.harness/references/writing-great-skills/GLOSSARY.md` in full, then follow `.harness/rules/skill-authoring.md`.

## Invoke shared workflows

- Invoke `$work` for feature work, bug fixes, refactors, and Electron changes. It supplies the implementation and review workflow.
- Invoke `$harness-improve` when changing harness rules, Skills, roles, verification, or repeated friction. It governs evidence-based harness evolution.

## Completion

Do not claim completion without fresh evidence from the relevant checks run after the final change. Report the commands and their current results; if a required check cannot run, state the blocker and do not represent the work as verified.
