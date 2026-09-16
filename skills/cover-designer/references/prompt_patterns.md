# Codex image2 Prompt Synthesis Guide

This guide details the exact prompt construction syntax and parameters for AI image-to-image cover generation using Codex image2, DALL-E, or Midjourney.

---

## 1. Prompt Architecture (The 6-Part Formula)

When prompting Codex image2 with an input screenshot, build the prompt in this strict sequence:

```
[Composition & Ratio] + [Subject Retain Instruction] + [Top Bilingual Typography] + [Material & Font Styling] + [Dynamic Color Harmony] + [Negative Constraints]
```

### Formula Template

> **Image-to-image cover prompt:**  
> A professional 4:3 social media video cover based on the provided screenshot. Retain the core subject and composition in the middle and lower portion of the image.  
> **Top Title:** Huge bold rounded cute cartoon 3D bubble typography at the very top center displaying Chinese text: `"[CHINESE_TITLE]"`.  
> **Subtitle:** Clean matching rounded sans-serif English subtitle placed directly below the Chinese title in all caps with wide tracking: `"[ENGLISH_SUBTITLE]"`.  
> **Typography Style:** 3D puffy bubble font, soft rounded corners, glossy candy finish, crisp double outline with a dark contrast outer stroke and bright inner fill, subtle 3D drop shadow lifting the text above the background.  
> **Color Scheme:** [PRIMARY_TEXT_COLOR] text fill matching the image's vibe, [ACCENT_STROKE_COLOR] outer stroke, warm/cool ambient glow harmonious with the photo's atmosphere. Do not use generic white-only text.  
> **Clean Background:** The top 25% area behind the text is subtly darkened/softened to ensure 100% text readability while preserving the screenshot's scene authenticity.  
> **Parameters:** Aspect ratio 4:3, high resolution, crisp graphic design poster layout.

---

## 2. Example Prompt Formulations

### Example A: Sunset / Warm Lifestyle Vlog
- **Chinese Title:** 日落温柔时
- **English Subtitle:** GOLDEN HOUR MEMORIES
- **Image Atmosphere:** Golden hour warm light, sea/city background
- **Generated Prompt:**
  ```text
  A 4:3 high-engagement video cover photo based on the provided screenshot. Keep the subject character centered in the lower 70% of the canvas.
  At the top center, display large bold 3D rounded cartoon bubble text: "日落温柔时", with a smaller English subtitle below: "GOLDEN HOUR MEMORIES" in clean rounded caps.
  Font styling: Soft rounded puffy cartoon letters, cream-custard fill (#FFF8E7), warm amber-orange double outline (#FF7700 and #4A1500), subtle soft shadow, glossy surface reflection.
  Ensure strong contrast against the warm sunset background. Proportions: Chinese title occupies 70% of banner height, English subtitle occupies 30%. Clean poster layout, 4:3 aspect ratio.
  ```

### Example B: Tech / AI Coding Highlight
- **Chinese Title:** 3分钟跑通AI
- **English Subtitle:** FAST TRACK TUTORIAL
- **Image Atmosphere:** Dark terminal/IDE, neon lighting
- **Generated Prompt:**
  ```text
  A 4:3 tech video thumbnail based on the provided screenshot. Preserve the code editor interface in the middle-lower region.
  Top header area features large 3D rounded bubble typography reading: "3分钟跑通AI", with a sleek English subtitle underneath: "FAST TRACK TUTORIAL".
  Text aesthetic: Vibrant electric lime-cyan fill (#00F5FF to #76FF03 gradient), deep midnight navy outer outline (#0A192F), bright neon ambient rim glow, pop-out 3D cartoon style with rounded beveled edges.
  Top background has a subtle translucent dark gradient backing to guarantee razor-sharp legibility. Aspect ratio 4:3, crisp typography, professional YouTube/Bilibili cover grade.
  ```

---

## 3. Critical Parameters & Negative Prompts

- **Aspect Ratio:** Always specify `4:3` (or `--ar 4:3` for Midjourney/compatible engines).
- **Text Exactness:** Always enclose literal text in straight quotation marks `""` so the model treats it as exact strings.
- **Negative Constraints:**
  `blur, illegible text, misspelled Chinese characters, serif fonts, thin strokes, text covering faces, cluttered text over eyes, muddy colors, washed out contrast.`
