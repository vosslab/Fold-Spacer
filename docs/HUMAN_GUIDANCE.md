# Human guidance

<!-- VENDORED HEADER: START -->
Record the durable guidance Neil Voss states, or approves for preservation here, in his own words:
first person or close paraphrase, one to three lines per bullet. Material he supplies as a source
may inform [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) once it is settled, and an entry of uncertain
origin belongs there too. Rules: [REPO_STYLE.md](REPO_STYLE.md).
[PROPAGATED HEADER - ENTRIES BELOW ARE YOURS]
<!-- VENDORED HEADER: END -->

## Decision priority

- Keep Fold Spacer as a WebGL 3D protein game while changing its control model to a stable,
  Subway Surfers-style three-lane runner.
- Aim for the trench-run feeling of Atari's 1983 Star Wars arcade game with modern WebGL graphics
  and Subway Surfers-style lane controls, without losing the protein structure.
- Keep the protein structure central to the experience; use the actual side chains as the objects
  the player avoids.
- Use TypeScript for new browser boundaries and Rust/WebAssembly for deterministic calculations.
- Move cohesive behavior out of the monolithic game script; use TypeScript modules for new game
  systems instead of preserving `game.js` as-is.

## Review expectations

- Prefer fewer, stronger permanent tests. Each test should protect behavior worth preserving
  without unnecessarily constraining future design.
- Treat tests as liabilities as well as assets. Tests can lock in undesirable behavior, so when in
  doubt, remove the test.
- Let permanent tests follow native language and framework conventions. Rust unit tests may stay
  inline under `#[cfg(test)]`, with durable integration tests in crate-level `tests/` directories.
- Use the ignored `tests/_temp/` subtree for temporary tests and one-time checks. Let pytest-suitable
  `test_*.py` files join the normal suite, run heavier checks explicitly, then promote or remove
  them before completion.
- Give each new blocking behavior gate a failure plan grounded in an actual need.
- Keep testing documentation concise, positive, and independently useful when skimmed. Repeat
  short principles where decisions happen and cross-reference the canonical details.

## Working style

- I want `tools/` for optional standalone user utilities that remain independent of repository-local
  packages, `devel/` for repository engineering, and the application for primary workflows and
  reusable behavior. A standalone tool may be a self-contained directory with its own helpers.
- A repository may use `launchers/` for thin application delegates when it needs them. Keep that
  convention optional rather than making it a propagated directory requirement.
- Use positive, action-oriented instructions for AI agents. State the desired artifact, action, and
  evidence with phrases such as "Use Y" or "Do X", and omit boundaries that do not aid the task.
- Ship `docs/PYTEST_STYLE.md` and `docs/PYTEST_AUTHORING_GUIDE.md`: the style guide defines
  permanent pytest policy, while the authoring guide explains implementation. Keep template-only
  propagation, vendoring, and meta-test coverage in `PYTEST_META_GUIDE.md`.
- I want Bash shell scripts to stay under 100 lines and 8000 characters. Simplify an oversized
  script or move substantial logic to Python, which has the existing 1000-line source limit.
- I normally use Graphify update or fresh, sometimes context, and now the published map. Keep this
  command line to those recurring actions, with Ollama available when my Claude usage is maxed out.
- Let one Graphify run update or rebuild the data and publish `docs/GRAPHIFY.md` with its compact
  community SVG. Never put the full per-symbol export under `docs/`.
- Let Markdown link checks include newly created, nonignored untracked files for their first 24
  hours. Keep ignored files unavailable.
