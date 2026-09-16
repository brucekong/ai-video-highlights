# Dynamic Color Palette & Contrast Guide

This reference provides systematic color matching strategies based on image aesthetics. **Never reuse a fixed color scheme from previous conversation context.** Always extract and adapt based on the specific screenshot.

---

## 1. Five Core Atmosphere Palettes

Analyze the dominant tones of the screenshot, then select the matching text hierarchy:

| Atmosphere | Image Dominant Tones | Primary Text Fill | Stroke (Inner / Outer) | Drop Shadow / Glow | Vibe & Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Warm Sunset / Food** | Orange, Amber, Warm Yellow | Cream Milk White `#FFF8E7` or Lemon `#FFEE55` | Inner: `#FFAA00`<br>Outer: `#4A1500` (Dark Umber) | Warm Orange Glow `#FF7700` with 40% opacity | Energetic, appetizing, lifestyle, emotional |
| **Tech / Cyber / Night** | Dark Blue, Purple, Neon | Electric Cyan `#00F5FF` or Lime `#76FF03` | Inner: `#FFFFFF`<br>Outer: `#0A192F` (Deep Navy) | Neon Cyan Glow `#00E5FF` with 60% opacity | Coding, AI, tech gadgets, tutorials |
| **Nature / Outdoor** | Green, Earth, Forest, Sky | Golden Yellow `#FFD700` or Pure White `#FFFFFF` | Inner: `#2E7D32` (Forest)<br>Outer: `#1B3B1B` | Soft dark brown shadow `#2A1A08` | Travel, outdoor sports, camping, vlog |
| **Minimal / High-Key (Bright)**| White, Light Grey, Pastel | Punchy Coral `#FF4D4D` or Cobalt `#1E40AF` | Inner: `#FFFFFF` (Thick)<br>Outer: `#1F2937` | Soft grey drop shadow `#9CA3AF` | Minimalist setup, clean productivity, review |
| **Dark / Cinema / Mystery** | Dark Charcoal, Muted Tones | Bright Tangerine `#FF6B00` or Highlighter Yellow `#FACC15` | Inner: `#FFFFFF`<br>Outer: `#111827` (Deep Black) | Deep black shadow `#000000` blur 12px | Film analysis, dramatic highlights, deep dives |

---

## 2. Readability Guarantees (The 3-Layer Rule)

Any text placed on real-world photo backgrounds risks illegibility if background complexity is high. Always enforce the **3-Layer Rule**:

1. **Layer 1: Text Fill (Core)**
   - High luminance, high saturation, rounded solid or subtle top-to-bottom vertical gradient (e.g., `#FFFDF0` to `#FFE57F`).
2. **Layer 2: Contrast Stroke (Border)**
   - Thickness: 6% ~ 10% of font size.
   - If fill is bright, stroke must be a deep saturated contrast color from the image's complementary hue (or crisp pure white inner + dark outer border).
3. **Layer 3: Offset Shadow / Glow (Separation)**
   - Offset: `x: 0, y: 6px ~ 10px`, Blur: `8px ~ 16px`.
   - Lifts the text off the photo surface, creating a tactile 3D sticker or pop-out effect.

---

## 3. Background De-cluttering Strategies (Top Area)

If the screenshot's top area has high visual noise (e.g. cluttered ceiling, text in original video, complex branches):

- **Soft Gradient Dimmer**: Add an invisible-to-subtle linear gradient overlay on the top 25% of the canvas (from `rgba(0,0,0,0.4)` to `rgba(0,0,0,0)` for bright text, or `rgba(255,255,255,0.5)` to `transparent` for dark text).
- **Glassmorphic / Bubble Pill Plate**: Put the bilingual text inside a semi-transparent rounded pill/capsule backdrop with blur (`backdrop-filter: blur(12px)`), colored with 30% opacity of the image's dominant tone.
