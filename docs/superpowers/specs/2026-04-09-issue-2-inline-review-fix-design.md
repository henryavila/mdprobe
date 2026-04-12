# Issue #2 — Fix AI agents presenting markdown inline instead of using mdProbe

**Date:** 2026-04-09  
**Issue:** henryavila/mdprobe#2  
**Branch:** feat/mcp-integration  

## Problem

AI agents with mdProbe installed paste markdown inline in conversation instead of saving to file + calling `mdprobe_view`. This bypasses rendering, annotations, and section approval. Happened 2x consecutively with ~110-line playbooks.

Root cause: all 3 activation layers (SKILL.md, PostToolUse hook, tool description) are **reactive** — they depend on the agent already having decided to save to file. None create the proactive impulse "I need review → use mdProbe".

**Expanded scope:** This applies to ANY long content the agent presents for human review — not just `.md` files. Findings, analysis, points for consideration, validation lists — anything >20 lines that the human needs to read and evaluate has poor UX in a terminal (scrolling, no annotations, no section approval). mdProbe should be the default for all long-form review.

## Fixes (PR 1 — this spec)

### Fix 1: SKILL.md — Frontmatter + Decision Rule + Anti-pattern

**Files:** `skills/mdprobe/SKILL.md`

Changes:
1. **Rewrite frontmatter `description`** — replace ambiguous "generating" with action-oriented trigger: "BEFORE asking for human feedback on ANY content >20 lines, save to file and use mdprobe_view"
2. **Add anti-pattern section** after "When NOT to Use" — explicit prohibition of inline review with positive alternative (decision rule). Covers all content types, not just .md files.
3. **Add decision rule** — if content >20 lines AND purpose is review/feedback → format as markdown + save to file via `content` param + mdprobe_view + wait

### Fix 2: Tool description — Concise semantic trigger

**Files:** `src/mcp.js` (line 61)

Change `mdprobe_view` description from:
> "Open markdown files in the browser for viewing or review"

To:
> "Open content for human review in the browser. Call this BEFORE asking for feedback on any content >20 lines — findings, specs, plans, analysis, or any long output."

Key phrase: **"BEFORE asking for feedback"** — creates semantic association `need review → call this tool`. Listing concrete content types (findings, specs, plans, analysis) broadens the trigger beyond just "markdown files".

### Fix 3: `content` parameter on `mdprobe_view`

**Files:** `src/mcp.js`

Add optional `content` + `filename` parameters to `mdprobe_view` that:
1. Accept raw markdown content as string
2. Save to `filename` in cwd (or temp file if omitted)
3. Open in browser via existing flow
4. Return URL + path where file was saved

This eliminates the 2-step failure (Write file → call tool) by doing both in one call.

**Input schema (updated):**
```
{
  // Existing — open files by path
  paths?: string[],
  // New — draft content directly
  content?: string,
  filename?: string,   // required when content is provided
  // Existing
  open?: boolean (default: true)
}
```

**Validation:** Either `paths` or `content`+`filename` must be provided, not both. Error if neither or both.

**Behavior when `content` is provided:**
1. Resolve `filename` relative to cwd
2. Write content to file (overwrite if exists)
3. Add file to server (same as paths flow)
4. Open browser if `open: true`
5. Return `{ url, file, savedTo }` — includes the absolute path where file was saved

### SKILL.md update for Fix 3

Add to SKILL.md rules section a note about using `content` parameter for drafting:

```
### Rule 8 — Draft and review in one step

When you have ANY content >20 lines that needs human review (findings, specs,
plans, analysis, validation lists), use the `content` parameter instead of
presenting it inline in the conversation:

> mdprobe_view({ content: "# My Spec\n...", filename: "spec.md", open: true })

This saves the file AND opens it for review in one call.
Format the content as markdown for best rendering (headings, lists, tables, code blocks).
The agent generates the content, so it controls the format.
```

### Fix 4: Singleton — Stale server detection

**Files:** `src/singleton.js`, `src/server.js`

**Problem found during this session:** MCP singleton discovery connected to a server from a previous session that had stale built assets. The browser loaded forever because the old server was serving outdated JS bundles.

**Root cause:** `discoverExistingServer()` checks PID alive + HTTP ping, but doesn't validate that the discovered server has compatible assets.

**Solution:** Add a build hash to the singleton protocol:

1. **Lock file** — include `buildHash` (hash of `dist/index.html` content, or package version) when writing
2. **`/api/status` response** — include `buildHash` in the response
3. **`discoverExistingServer()`** — compare lock file's `buildHash` against current process's `buildHash`. If mismatch → treat server as stale, clean up lock file, start fresh

**Behavior:**
- On `writeLockFile()`: compute and store `buildHash`
- On `discoverExistingServer()`: read lock file, if `buildHash` differs from current → `removeLockFile()` + return null (forces new server)
- Existing servers without `buildHash` in lock file → treated as stale (backward compat)

**Testing:**
- Stale server with different buildHash is rejected
- Server with matching buildHash is accepted
- Missing buildHash in lock file → rejected (backward compat)

## Out of scope (PR 2)

- **Stop hook** — safety net detecting inline markdown >40 lines without mdprobe_view call. Needs more design around false positives and intent detection.

## Testing Strategy (TDD)

### Unit tests — `content` parameter (`tests/unit/mcp.test.js`)

1. `mdprobe_view` with `content` + `filename` — saves file and returns path
2. `mdprobe_view` with `content` without `filename` — returns error
3. `mdprobe_view` with both `paths` and `content` — returns error
4. `mdprobe_view` with neither `paths` nor `content` — returns error  
5. `mdprobe_view` with `content` overwrites existing file
6. Tool description text matches expected semantic trigger

### Unit tests — singleton stale detection (`tests/unit/singleton.test.js`)

7. `discoverExistingServer` rejects server with different `buildHash`
8. `discoverExistingServer` accepts server with matching `buildHash`
9. `discoverExistingServer` rejects lock file missing `buildHash` (backward compat)
10. `writeLockFile` includes `buildHash` in written data
11. `/api/status` response includes `buildHash`

### SKILL.md validation tests

12. SKILL.md contains anti-pattern section
13. SKILL.md frontmatter description contains "BEFORE" trigger
14. SKILL.md contains decision rule for >20 lines
15. SKILL.md contains Rule 8 (content parameter, format as markdown)

## Success Criteria

- All new tests pass
- Existing 590 tests still pass
- SKILL.md has anti-pattern section + decision rule + frontmatter fix
- `mdprobe_view` tool description updated (covers all content types)
- `mdprobe_view` accepts `content` + `filename` parameters
- Singleton discovery rejects servers with stale/missing `buildHash`
