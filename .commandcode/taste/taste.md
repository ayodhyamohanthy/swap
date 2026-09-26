# Taste

## Workflow

- Drives long-running builds with terse one-word directives ("continue", "resume", "retry") rather than restating requirements; expects the agent to re-derive the current state from the repo (git status/diff, docs, build plan) and decide the next step autonomously. Confidence: 0.7
- Expects a running project's source of truth to live in-repo as versioned documents/designs plus a build plan, and wants implementation resumed from those artifacts rather than from chat memory. Confidence: 0.55

## Verification

- Works in an uncommitted, in-progress state and expects the agent to re-establish a green baseline (typecheck + test suite) before adding new features. Confidence: 0.5

## Product posture

- Targets mobile-first PWAs as the delivery form for the products they build (stated as the goal of the build, not a native app). Confidence: 0.6
