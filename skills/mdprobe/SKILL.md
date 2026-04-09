---
name: mdProbe
description: Render and review markdown files in the browser. Use whenever
  generating, editing, or referencing any .md file. Opens a live preview
  with annotations, section approval, and structured feedback via YAML sidecars.
---

# mdProbe — Markdown Reviewer (MCP)

## When to Use

- Generating, editing, or referencing any `.md` file
- Output longer than 40 lines (specs, RFCs, ADRs, design docs)
- Tables, Mermaid diagrams, math/LaTeX, syntax-highlighted code
- Human needs to **review and annotate** before you proceed
- You need **section-level approval** (approved/rejected per heading)

## When NOT to Use

- Short answers or code snippets (< 40 lines)
- Simple text responses with no markdown files involved
- Interactive debugging sessions

---

## MCP Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `mdprobe_view` | `{ paths, open? }` | `{ url, files }` | Open files in browser for viewing or review |
| `mdprobe_annotations` | `{ path }` | `{ source, sections, annotations, summary }` | Read annotations after human review |
| `mdprobe_update` | `{ path, actions[] }` | `{ updated, annotations, summary }` | Resolve, reopen, reply, add, or delete annotations |
| `mdprobe_status` | `{}` | `{ running, url?, files? }` | Check if server is running |

---

## Rules

### Rule 1 — Always show URL when citing .md

Whenever you mention a `.md` file path in output, call `mdprobe_view` and show the URL.

**Single file:**

> mdprobe_view({ paths: ["docs/spec.md"] })

Show: `📄 docs/spec.md → http://{urlStyle}:{port}/spec.md`

**Multiple files in one response — one combined call:**

> mdprobe_view({ paths: ["docs/spec.md", "docs/batch-1.md", "docs/batch-2.md"] })

Show: `📄 3 arquivos → http://{urlStyle}:{port}`

### Rule 2 — Review opens automatically

When the context is review (human needs to read and give feedback now):

> mdprobe_view({ paths: ["spec.md"], open: true })

Show:

```
📄 Aberto para revisão no browser.
Anote seus comentários. Me avise quando terminar.
```

For multiple files: `📄 3 specs abertos para revisão no browser.`

### Rule 3 — Read, address, and resolve annotations

When the human says they finished reviewing:

1. Read annotations for each reviewed file:
   > mdprobe_annotations({ path: "spec.md" })

2. Process each open annotation:
   - `bug` — fix the issue
   - `question` — answer or clarify
   - `suggestion` — evaluate and implement or justify skipping
   - `nitpick` — fix if trivial

3. Report what was addressed and **ask the human to confirm** before resolving.

4. After confirmation, resolve:
   > mdprobe_update({ path: "spec.md", actions: [
   >   { action: "resolve", id: "a1b2c3d4" },
   >   { action: "resolve", id: "e5f6g7h8" }
   > ]})

5. Human sees resolved annotations in real-time in the browser (greyed out).

**Never resolve without confirmation.** Always ask first.

### Rule 4 — Reply to explain decisions

When the fix isn't self-evident, add a reply explaining what was done before resolving:

> mdprobe_update({ path: "spec.md", actions: [
>   { action: "reply", id: "a1b2", comment: "Changed to PostgreSQL per ADR-003" },
>   { action: "resolve", id: "a1b2" }
> ]})

When you **disagree** with a suggestion, reply with justification but do NOT resolve — leave it open for the human to decide:

> mdprobe_update({ path: "spec.md", actions: [
>   { action: "reply", id: "c3d4", comment: "Keeping current approach because X. Let me know if you still want to change." }
> ]})

### Rule 5 — Pre-annotate areas of uncertainty

Before asking for review, create annotations to guide the human's attention:

> mdprobe_update({ path: "spec.md", actions: [
>   { action: "add",
>     selectors: { position: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 50 },
>                  quote: { exact: "Rate limit: 100/min", prefix: "", suffix: "" } },
>     comment: "Is 100/min enough? Load test showed 300/min spikes.",
>     tag: "question" },
>   { action: "add",
>     selectors: { position: { startLine: 78, startColumn: 1, endLine: 78, endColumn: 30 },
>                  quote: { exact: "Auth via JWT", prefix: "", suffix: "" } },
>     comment: "Two options: JWT or session cookies. I went with JWT for statelessness. OK?",
>     tag: "suggestion" }
> ]})

The human sees these annotations already in the browser when they start reviewing.

### Rule 6 — Delete only own annotations

You may delete your own annotations (where `author` matches your name) if they become irrelevant after changes. **Never delete human annotations** — resolve or reply instead.

> mdprobe_update({ path: "spec.md", actions: [
>   { action: "delete", id: "my-annotation-id" }
> ]})

### Rule 7 — No --once in Claude Code

The `--once` blocking mode is for scripted/CI use. In Claude Code, the human signals "done" via chat. Read annotations on demand via `mdprobe_annotations`.

Do NOT run `mdprobe spec.md --once` in Claude Code sessions.

---

## Review Workflow

1. Agent writes or edits `.md` file(s).
2. Agent calls `mdprobe_view({ paths, open: true })` — browser opens automatically.
3. Agent shows review message and waits for the human.
4. Human reads rendered markdown in the browser.
5. Human selects text and adds annotations (bug, question, suggestion, nitpick).
6. Human approves/rejects sections via heading buttons.
7. Human tells the agent they are done (via chat).
8. Agent calls `mdprobe_annotations({ path })` for each file.
9. Agent processes each open annotation — fixes bugs, answers questions, evaluates suggestions.
10. Agent reports what was addressed and asks the human to confirm.
11. After confirmation, agent calls `mdprobe_update` to resolve annotations with replies.
12. Human sees resolved annotations in real-time (greyed out in browser).
13. If new issues remain, repeat from step 4.

---

## Annotation Tags

| Tag | Meaning | When used |
|-----|---------|-----------|
| `bug` | Something is wrong | Factual errors, incorrect logic, broken examples |
| `question` | Needs clarification | Ambiguous requirements, missing context |
| `suggestion` | Improvement idea | Better approach, additional feature, alternative |
| `nitpick` | Minor style/wording | Typos, formatting, naming preferences |

---

## Section Approval

The human can approve or reject each section (heading) of the document via buttons in the browser UI.

**Cascade behavior:** Approving a parent heading (e.g., H2) automatically approves all child headings (H3, H4, ...) under it. Same for reject and reset.

**Checking approval status:**

> mdprobe_annotations({ path: "spec.md" })

The response includes a `sections` array:

```
sections: [
  { heading: "Requirements", level: 2, status: "approved" },
  { heading: "Architecture",  level: 2, status: "rejected" },
  { heading: "API Design",    level: 3, status: "pending" }
]
```

All sections must be `approved` and all annotations resolved before the document is considered fully reviewed.
