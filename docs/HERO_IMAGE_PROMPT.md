# Hero Image Prompt — mdprobe

## Para ComfyUI / Stable Diffusion

### Prompt principal

```
A clean, modern developer tool screenshot mockup floating on a dark gradient background. The mockup shows a split-panel markdown review interface: left side has a rendered markdown document with colorful syntax-highlighted code blocks, mermaid diagrams, and heading hierarchy; right side shows an annotation panel with color-coded comment cards (blue for questions, red for bugs, green for suggestions, amber for nitpicks). A floating annotation popover with a text input is visible over the document. The UI uses a dark Catppuccin Mocha color scheme with deep navy backgrounds (#1e1e2e), soft blue accents (#89b4fa), and subtle rounded corners. The word "mdprobe" appears in a minimal monospace font at the top. Professional product hero image style, sharp edges, slight perspective tilt, soft ambient glow behind the mockup, 16:9 aspect ratio.
```

### Negative prompt

```
blurry, low quality, pixelated, watermark, text artifacts, photorealistic humans, stock photo, clipart, cartoon, 3d render of people, hands, fingers, noisy, grain, oversaturated, neon colors, busy background, cluttered
```

### Configuracoes recomendadas

- **Resolucao:** 1280x720 ou 1920x1080
- **Steps:** 30-40
- **CFG Scale:** 7-8
- **Sampler:** DPM++ 2M Karras ou Euler a
- **Model:** SDXL base ou Juggernaut XL (bom para UI mockups)

### Alternativa mais abstrata (se o mockup ficar ruim)

```
Minimal abstract tech illustration for a developer tool called "mdprobe". Dark navy gradient background (#1e1e2e to #181825). A large translucent document icon in the center with subtle markdown heading symbols (# ## ###) floating inside it. Around the document, small floating pills in four colors: blue (#89b4fa), red (#f38ba8), green (#a6e3a1), amber (#f9e2af) representing annotation tags. Thin connecting lines between the pills and the document. A subtle magnifying glass or probe element overlapping the document corner. Clean, geometric, flat design with soft depth shadows. Monospace "mdprobe" text below. Developer tool branding style, minimal, dark mode aesthetic.
```

### Negative prompt (abstrata)

```
photorealistic, humans, faces, hands, busy, cluttered, bright colors, neon, 3d render, cartoon, childish, stock photo, watermark, text errors, blurry
```
