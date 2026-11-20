# Meshy MCP + Google Gemini integration — validation report

## Baseline

- Branch `security/mcp-auth`, commit `1896651438b02c238824d8b80a54d3168d19ba46` (package version `0.6.12`).
- This change: package version `0.6.13`, branch `feature/gemini-images`.

## What changed

- Optional `GEMINI_API_KEY`; new tool `google_generate_image` (Gemini Interactions REST API, `store: false`), independent of Meshy credits, Standard (non-Batch) pricing.
- New files: `src/schemas/gemini-image.ts`, `src/services/gemini-image-client.ts`, `src/tools/gemini-image.ts`, `tests/gemini-image.test.mjs`, `tests/http-auth.test.mjs`.
- Existing source touched only in `src/index.ts` (tool registration + log line) and `src/instructions.ts` (routing/cost guidance). No Meshy tool and no Bearer middleware code was modified.
- `tests/user-agent.test.mjs`: sends the test Bearer token and expects the new package version `0.6.13` (the original patch left the hardcoded `0.6.12`, which made `npm test` fail).
- CI (`.github/workflows/ci.yml`) also runs on pushes to `security/mcp-auth` and `feature/**`, and on PRs targeting `security/mcp-auth`.

## Checks actually run (Node 22.23.5)

- `npm ci`: exit 0.
- `npm run lint` (`tsc --noEmit`): exit 0.
- `npm test` (`tsc` build + `node --test tests/*.test.mjs`): 160 tests, 160 pass, 0 fail.
  - The patch as delivered gave 159/160 (stale `0.6.12` version assertion); fixed here.

## Not done

- No live call to Google (no API key); Gemini behaviour is covered by a local mock HTTP server only.
- CI matrix Node 18/20 was not run locally (only Node 22); GitHub Actions covers it.
- No deployment to Render.
