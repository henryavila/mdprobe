# Hero Image Prompts — mdProbe

Optimized for **Z-Image Turbo** (Tongyi-MAI). CFG = 0, steps = 8-12, no negative prompts.
All constraints embedded as positive instructions.

---

## Concept A — Scan Beam

A horizontal beam of blue light sweeps across a dark floating markdown document, revealing code review annotations. The document is a rounded-corner card on a deep navy background (#1e1e2e), showing monospace text with markdown headings in blue and body text in gray. The scan beam is a thin bright cyan-blue horizontal line crossing the middle of the document, emitting a soft glow and subtle light diffusion above and below. Where the beam has passed, small colored pill-shaped badges float outward from the document edges: a red badge reading "bug", a blue badge reading "question", a green badge reading "suggestion", and an amber badge reading "nitpick". Each badge has a faint matching glow. The document shows highlighted lines with colored left borders at the positions connected to each badge. The text "mdProbe" appears in a minimal monospace font at the top left corner, small and understated. Dark mode developer tool aesthetic, clean geometric composition, flat design with subtle depth from glows and shadows, 16:9 aspect ratio, sharp focus, no people, no hands, no watermarks, no logos other than mdProbe.

## Concept B — Probe Field

A dark markdown document card pulses with a faint blue analytical energy field, radiating findings outward through thin connection lines. The document sits centered on a deep navy background (#1e1e2e to #181825 gradient), showing monospace markdown text with blue headings and gray body text. Certain lines inside the document are highlighted with colored left borders: red, blue, and green. From each highlighted line, a thin translucent connection line extends outward to a floating badge at the document edge. The badges are rounded pill shapes with subtle glows: a red pill labeled "L5 bug", a blue pill labeled "L7 question", a green pill labeled "L9 suggestion". Two concentric subtle rounded rectangles surround the document like a pulsing containment field, barely visible. The document border glows faintly blue. The text "mdProbe" appears small in monospace at the top left. Dark mode developer tool branding, clean minimalist composition, flat design with soft luminous accents, no clutter, 16:9 aspect ratio, sharp rendering, no people, no hands, no watermarks.

## Concept C — Orbit Probe

A centered markdown document surrounded by orbiting code review badges, like satellites around a planet. Deep navy-black background (#0d1117 to #1a1f2e gradient). The document is a rounded card showing monospace markdown with blue heading text and gray body, with three lines highlighted by colored left borders (red, blue, green). Around the document, two faint concentric circles suggest an orbit path, drawn with very subtle blue lines. Four colored pill-shaped badges orbit at different positions around the circles: a red badge reading "bug" at top-right, a blue badge reading "question" at mid-right, a green badge reading "suggestion" at bottom-left, and an amber badge reading "nitpick" at top-left. Each badge emits a soft matching glow. Faint thin lines connect some badges back to their corresponding highlighted lines in the document. A very subtle crosshair reticle pattern sits behind the document, barely visible. The text "mdProbe" appears in minimal monospace at the top left. Dark mode developer aesthetic, clean orbital composition, flat design with soft sci-fi glow accents, 16:9 aspect ratio, sharp focus, no people, no watermarks.

---

## Settings (Z-Image Turbo)

| Parameter | Value |
|-----------|-------|
| Steps | 8–12 |
| CFG Scale | 0 (official pipeline) |
| Resolution | 1280x720 or 1920x1080 (16:9) |
| Acceleration | none (quality) or regular (speed) |
| Seed | Fix while iterating, vary to explore |

**Tips:**
- Z-Image Turbo does NOT support negative prompts — all constraints are in the positive prompt
- Text in double quotes has best rendering fidelity
- If badges text doesn't render clean, try adding: crisp readable text on badges, sharp typography
- If image looks plastic, add: subtle film grain, natural imperfections
- Iterate by changing seed first, then refine prompt wording
