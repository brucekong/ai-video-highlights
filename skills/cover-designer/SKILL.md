---
name: cover-designer
description: |
  WHAT: Design and generate high-converting 4:3 (and multi-platform) video/article cover images featuring bilingual rounded cartoon typography, dynamic color harmony, and composition safety zones.
  WHEN: Use when creating cover images, video thumbnails, social media cards (Xiaohongshu, Bilibili, YouTube), crafting Codex image2 / Midjourney / DALL-E image-to-image prompts from screenshots, or styling top-aligned bilingual text overlays.
  KEYWORDS: "cover image", "make cover", "thumbnail", "封面图", "制作封面", "封面生成", "4:3封面", "视频封面", "image2", "codex image2"
---

# Cover Designer

Professional procedural workflow for transforming raw video screenshots into high-click-through 4:3 cover images. Combines bilingual typography hierarchy, dynamic color extraction, and Codex image2 prompt generation.

---

## Core Philosophy: The 3-Second Visual Hook

A cover image is not just an illustration—it is a click-through conversion tool. In fast-scrolling feeds (Xiaohongshu, Bilibili, YouTube):
1. **Top Visual Focus**: Users scan from top to bottom. The top 25% must instantly convey the core emotional hook or value proposition.
2. **Dynamic Harmony, Zero Repetition**: Never recycle hardcoded font colors from past sessions. Every screenshot has unique lighting, saturation, and subject matter. The text palette must organically emerge from that specific image.
3. **Bilingual Hierarchy**: Chinese text provides the immediate semantic punch; English subtitle provides balance, modern aesthetic rhythm, and structural stability.

---

## Design Specifications & Golden Rules

### 1. Canvas & Safe Margins (4:3 Standard)
- **Primary Ratio**: `4:3` (Recommended resolution: `1440 × 1080` or `1200 × 900`).
- **Top Safe Margin**: Text starts `8% ~ 10%` from the top edge (`80px ~ 110px` on 1080p).
- **Horizontal Margin**: Minimum `8%` left/right buffer to prevent platform UI clipping.
- **Subject Safe Zone**: Keep the main subject (person face, key interface, food) in the lower `70%` of the frame. Never place title text directly across eyes, faces, or primary focal points.

### 2. Bilingual Typography Proportions
- **Main Title (Chinese)**:
  - **Typeface**: Extra-bold rounded cartoon / 3D bubble font (`圆角粗体 / 泡泡体`).
  - **Visual Weight**: Dominates `65% ~ 75%` of the total text block height.
  - **Copywriting**: 4 to 8 characters max. Remove punctuation; use whitespace or emoji (`🔥`, `✨`) for pauses.
- **Subtitle (English)**:
  - **Typeface**: Clean geometric rounded sans-serif in `ALL CAPS` (e.g., Arial Rounded MT Bold, SF Pro Rounded, Nunito).
  - **Visual Weight**: `35% ~ 40%` of Chinese title font size.
  - **Letter-Spacing (Tracking)**: `+0.25em ~ +0.35em` (wide tracking creates a premium, international editorial look).
  - **Gap**: Tight spacing (`15px ~ 25px`) below the Chinese title, forming a cohesive singular graphic block.

### 3. Dynamic Color Extraction Algorithm
Before generating any prompt or styling, execute this 3-step color determination:

1. **Assess Dominant Tone & Lightness**:
   - Is the background at the top dark, bright, or busy?
   - What are the 2 primary ambient colors in the screenshot?
2. **Select Text Fill & Contrast Stroke**:
   - Read the detailed matching tables in [color_palette_guide.md](references/color_palette_guide.md).
   - **Bright/Sunset Scene**: Cream/custard fill + deep amber/dark chocolate double outline.
   - **Dark/Cyber Scene**: Electric cyan/lime fill + deep midnight navy outline + neon rim glow.
   - **Nature/Green Scene**: Golden yellow/clean white fill + forest green/espresso outline.
3. **Mandatory 3D Pop**: Always apply a 2-layer or 3-layer structure:
   - `Core Text Fill` -> `High-Contrast Outer Outline (6~10% stroke width)` -> `Soft Offset Drop Shadow (blur 12px, y-offset +8px)`.

---

## Workflow: Generating Covers with Codex image2

When the user provides a screenshot and requests a cover image:

```
┌────────────────────────┐
│ 1. Analyze Screenshot  │ ──► Identify subject position, top noise, ambient lighting & palette
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ 2. Formulate Copy      │ ──► Punchy Chinese Title (4-8 chars) + Matching English Subtitle (Caps)
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ 3. Extract Palette     │ ──► Consult references/color_palette_guide.md for dynamic contrast scheme
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ 4. Build image2 Prompt │ ──► Consult references/prompt_patterns.md & construct the 6-part prompt
└───────────┬────────────┘
            │
┌───────────▼────────────┐
│ 5. Deliver Dual-Output │ ──► (A) Ready-to-use image2 Prompt
└────────────────────────┘     (B) High-fidelity SVG code template for 100% accurate Chinese rendering
```

### Prompt Construction Template for Codex image2
Consult [prompt_patterns.md](references/prompt_patterns.md) for full syntax. Output the prompt formatted clearly for the user to paste into Codex image2:

```text
A professional 4:3 social media video cover based on the provided screenshot.
Preserve the core subject in the center-lower region of the frame.
At the top center, display large bold 3D rounded cartoon bubble typography reading Chinese text: "[CHINESE_TITLE]".
Directly beneath it, include an English subtitle in all-caps rounded sans-serif with wide letter-spacing: "[ENGLISH_SUBTITLE]".
Typography aesthetics: Puffy bubble letters, smooth rounded corners, glossy candy highlight, double outline with [CONTRAST_OUTER_COLOR] outer stroke and [DYNAMIC_FILL_COLOR] inner fill, realistic soft drop shadow.
The top 25% background has a subtle translucent dark gradient to ensure maximum text readability while keeping the original image natural.
Aspect ratio 4:3, high visual contrast, clean modern graphic poster composition.
```

---

## Typography Accuracy Fallback (SVG Template)

AI image generators (including Codex image2 / DALL-E) may occasionally generate deformed Chinese strokes. When 100% pixel-perfect Chinese typography is required:
- Refer to [cover_template_4x3.svg](assets/cover_template_4x3.svg).
- Provide the user with an SVG overlay or render it directly via browser/canvas using the exact extracted colors and titles.

---

## Anti-Patterns: What NEVER to Do

- **NEVER reuse a static color palette across different covers**: Every image has distinct color temperatures; reusing colors causes visual clash or unreadable low contrast.
- **NEVER place title text across faces or subject eyes**: Always leave the top 25% clear or move subjects downward.
- **NEVER use thin, serif, or low-weight fonts**: Fine lines dissolve against photo backgrounds; always use extra-bold rounded bubble typography.
- **NEVER use punctuation in the main title**: Avoid commas, periods, or question marks in titles; use whitespace or emoji stickers instead.
- **NEVER cram English subtitles tightly**: English subtitles without letter-spacing look cramped and subordinate; always use wide tracking (`0.25em ~ 0.35em`).
- **NEVER put raw text directly onto a noisy background**: If the background has high contrast details, always add a soft gradient dimmer or frosted glass capsule plate.
