# petto-petto Design Guide

## 1. Design Direction

petto-petto is a pixel UI inspired by a small pet space deep in a dark forest. Place wood- and parchment-textured panels over a deep forest background, and render pets and controls with crisp, integer-aligned pixels.

- Do not use rounded cards, glass effects, or soft shadows.
- Build borders and shadows from sharp pixel units.
- Present information on calm parchment panels, controls on wood buttons, and achievements or rarity with gold and rarity colors.
- Keep the background quiet so pets, selection, and progress states receive the strongest visual attention.

## 2. Color

### Core Tokens

| Role | Value |
| --- | --- |
| Deepest forest background | `#10231A` |
| Mid forest | `#1C4A34` |
| Bright foliage | `#3C7A4A` |
| Forest glow | `#8FD68A` |
| Wood border | `#3A2A1C` |
| Wood surface | `#6B4A2E` |
| Wood highlight | `#A5763F` |
| Parchment surface | `#F3E3C0` |
| Parchment inner ring | `#E0C894` |
| Text on light panels | `#3B2A1A` |
| Text on dark surfaces | `#F5ECD8` |
| Gold accent | `#FFD166` |
| Dark outline | `#2C2438` |

### States and Rarity

| State | Light color | Dark background |
| --- | --- | --- |
| COMMON | `#9AA0A6` | `#62676C` |
| RARE | `#4AA3FF` | `#1F5A99` |
| EPIC | `#B46BFF` | `#6C37A0` |
| Warning | `#F0B775` | `#725127` |
| Error | `#F08A8A` | `#762F35` |
| Disabled | `#999999` | `#555555` |

- Use rarity colors only to communicate rarity: rarity badges, inner borders of collection slots, and pet rarity icons.
- Reserve gold for the current selection, achievements, and rewards that require immediate attention.
- Never distinguish warnings or errors by color alone; pair color with an icon or text.

## 3. Typography

- Use `Galmuri9` for body copy and bold `Galmuri11` for headings and rarity labels.
- Use `ui-monospace, monospace` as the fallback stack.
- Use only `10 / 11 / 12 / 13 / 15 / 16px` font sizes.

| Use | Size | Font |
| --- | --- | --- |
| Secondary information and numeric labels | 10px | Body |
| Rarity badges | 11px | Heading |
| Body copy, buttons, and progress | 12px | Body |
| Screen labels | 13px | Heading |
| Panel titles | 15px | Heading |
| Screen titles | 16px | Heading |

- Do not smooth pixel-font edges. Apply `-webkit-font-smoothing: none` and `text-rendering: optimizeSpeed`.
- Keep body copy short and value-focused; do not pack excessive information into one line.
- Use light text on dark surfaces and ink-colored text on parchment surfaces.

## 4. Pixel Rendering

- Scale sprites, pixel backgrounds, and pixel icons only by integer factors.
- Apply `image-rendering: pixelated` to images and set `imageSmoothingEnabled = false` for Canvas rendering.
- Use `#2C2438` as the shared outline color for pet sprites.
- Keep the light source in the upper left. Place highlights toward the upper left and shadows toward the lower right.
- Pet pixels are either fully transparent or fully opaque.

## 5. Shape and Spacing

### Spacing

Use a 2px base unit and the following values for layout.

| Name | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Between an icon and a short label |
| `space-2` | 6px | Between small items |
| `space-3` | 8px | Button padding |
| `space-4` | 10px | Between related information groups |
| `space-5` | 12px | Card and grid gaps |
| `space-6` | 14px | Panel padding |
| `space-7` | 18px | Screen edge padding |

### Borders and Shadows

- Do not use `border-radius` for standard UI elements.
- Use blur-free `2px 2px 0` offsets for external drop shadows. Use inset highlights and shading only to create bevels.
- Parchment panels use a 3px wood border, 2px wood highlight, and 5px parchment inner ring.
- Wood buttons use a 2px wood border with a light top edge and a dark bottom edge to create depth.

```css
.pixel-panel {
  border: 3px solid #3A2A1C;
  box-shadow:
    inset 0 0 0 2px #A5763F,
    inset 0 0 0 5px #E0C894,
    2px 2px 0 rgba(0, 0, 0, 0.35);
}

.pixel-button {
  border: 2px solid #3A2A1C;
  box-shadow:
    inset 0 2px 0 #A5763F,
    inset 0 -2px 0 #3A2A1C,
    2px 2px 0 rgba(0, 0, 0, 0.35);
}
```

## 6. Components

### Panels

- Use parchment as the default surface for information panels.
- Place panel titles in the upper left, with 8–14px between the title and body content.
- Structure dense information in three levels: title, primary value, then supporting information.

### Buttons

- Use the wood surface with light text for primary buttons.
- Render disabled buttons with a gray surface and lower-contrast text; do not provide a pressed interaction.
- On press, move the button with `translate(2px, 2px)` and remove its drop shadow.
- Give icon-only buttons a visible text label or an accessible name.

### Badges and Progress

- Build rarity badges with a dark rarity-color background, a light rarity-color border, and `#F5ECD8` text.
- Use a 10px-high XP bar with a 2px border.
- Fill XP bars vertically from `#8FD68A` to `#3C7A4A` to `#1C4A34`.
- Pair progress color with a number or short status label.

### Pets and Selection

- Keep pets in the central activity area with enough empty space to draw attention before surrounding panels.
- Mark the current selection with a 2px gold dashed border.
- Use a small elliptical ground shadow without obscuring the pet outline or essential information.

## 7. Screen Layout

### Pet Room

- Build the background in three layers: deep forest, midground foliage, and a floor clearing.
- Place the pet clearing in the lower center and make it slightly brighter than its surroundings.
- Keep detail panels at screen edges where they do not block pet movement or status.
- Group controls to one side to preserve the pet's activity space.

### Collection

- Arrange collection entries in a grid of equal square slots.
- Keep 12px gaps between slots.
- Use sprites and rarity colors for acquired pets; use low-contrast empty slots for unacquired pets.
- Show selection with a gold outer border and rarity with an inner rarity-color border and badge. Do not let background decoration compete with these states.

## 8. Motion and Accessibility

- Use motion only as brief feedback for state changes.
- Communicate button presses through position, and use small pixel-scale pop effects for new pets or rewards.
- Avoid decorative looping animation; reduce or remove motion for `prefers-reduced-motion`.
- Make keyboard focus clear with a 2px gold outline and an outer 1px `#2C2438` support ring.
- Maintain sufficient contrast between text and backgrounds, including at small pixel-font sizes.
- Pair color-dependent states with an icon, text, or pattern.
