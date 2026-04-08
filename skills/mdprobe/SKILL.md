---
name: mdprobe
description: Use mdprobe to render markdown in the browser and collect structured human feedback (annotations, section approvals) via YAML sidecar files
---

# mdprobe — Markdown Viewer & Reviewer

Render markdown in the browser. Collect structured feedback from humans. Read it back as YAML.

## When to Use

- Output longer than 40-60 lines (specs, RFCs, ADRs, design docs)
- Tables, Mermaid diagrams, math/LaTeX, syntax-highlighted code
- When you need the human to **review and annotate** before you proceed
- When you need **section-level approval** (approved/rejected per heading)

## When NOT to Use

- Short answers or code snippets (< 40 lines)
- Simple text responses
- Interactive debugging sessions

---

## View Mode — render and continue working

Write markdown to a file, launch mdprobe in the background. The human reads while you keep working.

```bash
# Write your output
cat > output.md << 'EOF'
# Your spec here
EOF

# Launch viewer (browser opens automatically, process runs in background)
mdprobe output.md &
```

Use `run_in_background: true` when calling via Bash tool. Add `--no-open` if you don't want the browser to auto-open.

The server watches for file changes — if you update the `.md` file, the browser hot-reloads automatically.

## Review Mode — block until human finishes

When you need the human to review and annotate before you continue:

```bash
# This BLOCKS until the human clicks "Finish Review" in the browser
mdprobe spec.md --once
```

The process prints paths to generated `.annotations.yaml` files on exit. Exit code 0 means review complete.

### Full agent workflow

```
1. Agent writes spec.md
2. Agent runs: mdprobe spec.md --once        (process BLOCKS here)
3. Human opens browser, reads the rendered markdown
4. Human selects text → adds annotations (bug, question, suggestion, nitpick)
5. Human approves/rejects sections via heading buttons
6. Human clicks "Finish Review"
7. Process unblocks, prints YAML paths to stdout
8. Agent reads spec.annotations.yaml
9. Agent addresses each annotation
```

---

## Reading Annotations

After review, load the YAML sidecar and process the feedback:

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'

const af = await AnnotationFile.load('spec.annotations.yaml')

// Query annotations
const open = af.getOpen()           // all unresolved annotations
const bugs = af.getByTag('bug')     // only bugs
const questions = af.getByTag('question')
const mine = af.getByAuthor('Alice')
const resolved = af.getResolved()   // already handled
const one = af.getById('a1b2c3d4')  // specific annotation

// Each annotation has:
// {
//   id, selectors: { position: { startLine, startColumn, endLine, endColumn },
//                     quote: { exact, prefix, suffix } },
//   comment, tag, status, author, created_at, updated_at,
//   replies: [{ author, comment, created_at }]
// }

// Process feedback
for (const ann of open) {
  console.log(`[${ann.tag}] Line ${ann.selectors.position.startLine}: ${ann.comment}`)
  if (ann.replies.length > 0) {
    for (const reply of ann.replies) {
      console.log(`  ↳ ${reply.author}: ${reply.comment}`)
    }
  }
}

// Mark as handled
af.resolve(bugs[0].id)
await af.save('spec.annotations.yaml')
```

## Checking Section Approvals

The human can approve or reject each section (heading) of the document. Check the status:

```javascript
const af = await AnnotationFile.load('spec.annotations.yaml')

// sections: [{ heading, level, status }]
// status is: 'approved', 'rejected', or 'pending'
for (const section of af.sections) {
  console.log(`${section.heading}: ${section.status}`)
}

// Check if all sections were approved
const allApproved = af.sections.every(s => s.status === 'approved')

// Find rejected sections that need rework
const rejected = af.sections.filter(s => s.status === 'rejected')
```

Approval cascades: if the human approves a parent heading (e.g., H2), all child headings (H3, H4...) under it are also approved. Same for reject and reset.

## Export Formats

```javascript
import { exportJSON, exportSARIF, exportReport } from '@henryavila/mdprobe/export'
import { readFile } from 'node:fs/promises'

const af = await AnnotationFile.load('spec.annotations.yaml')
const source = await readFile('spec.md', 'utf-8')

const json = exportJSON(af)              // plain JS object
const sarif = exportSARIF(af, 'spec.md') // SARIF 2.1.0 (open annotations only)
const report = exportReport(af, source)  // markdown review report
```

SARIF maps tags to severity: `bug` = error, `suggestion` = warning, `question`/`nitpick` = note.

## Annotation Tags

| Tag | Meaning | When the human uses it |
|-----|---------|----------------------|
| `bug` | Something is wrong | Factual errors, incorrect logic, broken examples |
| `question` | Needs clarification | Ambiguous requirements, missing context |
| `suggestion` | Improvement idea | Better approach, additional feature, alternative |
| `nitpick` | Minor style/wording | Typos, formatting, naming preferences |

## Interacting with Annotations

### Resolving annotations after you fix them

After addressing an annotation, mark it as resolved so the human knows it's been handled:

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'

const af = await AnnotationFile.load('spec.annotations.yaml')

for (const ann of af.getOpen()) {
  // Process the annotation (fix the bug, answer the question, etc.)

  // Mark as resolved
  af.resolve(ann.id)
}

// Persist changes — the human will see these as resolved in the UI
await af.save('spec.annotations.yaml')
```

### Replying to annotations

Add a reply to explain what you did, ask for clarification, or acknowledge the feedback:

```javascript
const af = await AnnotationFile.load('spec.annotations.yaml')

const bugs = af.getByTag('bug')
for (const bug of bugs) {
  af.addReply(bug.id, {
    author: 'Agent',
    comment: `Fixed in commit abc123. Changed line ${bug.selectors.position.startLine}.`,
  })
  af.resolve(bug.id)
}

await af.save('spec.annotations.yaml')
```

### Creating annotations before human review

Pre-annotate sections you're unsure about, so the human knows where to focus:

```javascript
const af = await AnnotationFile.load('spec.annotations.yaml')

af.add({
  selectors: {
    position: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 60 },
    quote: { exact: 'Rate limit: 100 requests per minute', prefix: '', suffix: '' },
  },
  comment: 'Is 100/min enough? The load test showed spikes of 300/min.',
  tag: 'question',
  author: 'Agent',
})

await af.save('spec.annotations.yaml')
```

### Interacting via HTTP API (while server is running)

If the server is running (view mode), you can interact without touching the YAML file directly:

```bash
# Create an annotation
curl -X POST http://127.0.0.1:3000/api/annotations -H 'Content-Type: application/json' -d '{
  "file": "spec.md",
  "action": "add",
  "data": {
    "selectors": {
      "position": { "startLine": 10, "startColumn": 1, "endLine": 10, "endColumn": 40 },
      "quote": { "exact": "text to annotate", "prefix": "", "suffix": "" }
    },
    "comment": "This needs work",
    "tag": "suggestion",
    "author": "Agent"
  }
}'

# Resolve an annotation
curl -X POST http://127.0.0.1:3000/api/annotations -H 'Content-Type: application/json' -d '{
  "file": "spec.md",
  "action": "resolve",
  "data": { "id": "a1b2c3d4" }
}'

# Add a reply
curl -X POST http://127.0.0.1:3000/api/annotations -H 'Content-Type: application/json' -d '{
  "file": "spec.md",
  "action": "reply",
  "data": { "id": "a1b2c3d4", "author": "Agent", "comment": "Fixed." }
}'

# Approve a section
curl -X POST http://127.0.0.1:3000/api/sections -H 'Content-Type: application/json' -d '{
  "file": "spec.md",
  "action": "approve",
  "heading": "Requirements"
}'
```

The browser auto-updates when annotations change — the human sees your replies and resolutions in real time.

### Iterative review loop

When the first review produces feedback, fix the issues and re-launch for a second pass:

```
Round 1:
  1. Agent writes spec.md
  2. mdprobe spec.md --once → human annotates 5 bugs, 3 questions
  3. Agent reads feedback, fixes all 5 bugs, answers 3 questions
  4. Agent marks all 8 as resolved, adds replies explaining fixes

Round 2:
  5. Agent re-launches: mdprobe spec.md --once
  6. Human sees resolved items (greyed out), reviews fixes
  7. Human adds 1 new nitpick, approves all sections
  8. Agent reads feedback — 1 nitpick to fix, all sections approved
  9. Done — proceed to implementation
```

```javascript
// After fixing issues from round 1:
const af = await AnnotationFile.load('spec.annotations.yaml')

// Mark everything as resolved with explanations
for (const ann of af.getOpen()) {
  af.addReply(ann.id, {
    author: 'Agent',
    comment: 'Addressed in updated spec.',
  })
  af.resolve(ann.id)
}
await af.save('spec.annotations.yaml')

// Re-launch for round 2
// exec: mdprobe spec.md --once
```

## Drift Detection

If you modify the source `.md` after annotations were created, mdprobe warns the human that the source has changed (annotations may be stale). The hash is stored in the YAML:

```yaml
source_hash: "sha256:abc123..."
```

## Schema Validation

A JSON Schema is available for validating annotation YAML files:

```javascript
import schema from '@henryavila/mdprobe/schema.json'
```

---

## Recommended Patterns

### Pattern: spec review before implementation

```bash
# 1. Write the spec
cat > spec.md << 'SPEC'
# Feature: User Authentication
## Requirements
...
SPEC

# 2. Get human review (blocks until done)
mdprobe spec.md --once

# 3. Read feedback
node -e "
import { AnnotationFile } from '@henryavila/mdprobe/annotations'
const af = await AnnotationFile.load('spec.annotations.yaml')
console.log(JSON.stringify(af.getOpen(), null, 2))
"
```

### Pattern: background viewer while working

```bash
# Start viewer in background
mdprobe docs/ --no-open &

# Continue working — browser shows rendered docs with live reload
# Human reads at their own pace
```

### Pattern: check if human approved all sections

```javascript
const af = await AnnotationFile.load('spec.annotations.yaml')
const pending = af.sections.filter(s => s.status !== 'approved')
if (pending.length > 0) {
  console.log('Sections not yet approved:', pending.map(s => s.heading))
}
```
