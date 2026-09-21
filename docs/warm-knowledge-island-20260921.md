# 温暖版 FREE-BBS 主岛

仅更新学习世界中央主岛的美术素材与环带配色，不改动知识岛布局、课程内容或点击行为。

- 成品：`public/assets/planet-bbs-hub-warm-v4.webp`，900 × 900，真实透明背景。
- 保留旧版 `planet-bbs-hub-v3.webp`，便于比较与回退。
- 制作方式：内置 imagegen 编辑；参考旧主岛的构图与 `max-guide-v1.webp` 的奶油白、焦糖色及卡通风格。
- 导出：sharp 等比缩放、WebP 压缩并保留 alpha，无额外手绘或背景抠图。
- 验证：素材透明度、四角透明、体积上限以及导览交互回归；本地预览检查明暗主题。

## 最终生成提示词

```text
Use case: style-transfer.
Asset type: transparent web sprite for the central FREE-BBS knowledge island, readable at 200–260px.
Input images: Image 1 is the edit target: current floating knowledge island. Image 2 is palette and illustration style reference ONLY: Max mascot. Do not insert the person.
Redraw Image 1 as a polished, warm, charming cartoon miniature knowledge village matching Max's cream ivory, honey amber and caramel colors. Retain the compact round floating island composition and recognizable connected architecture: central ram-horn observatory, library dome and open book/telescope, discussion amphitheater, little workshop/greenhouse, short bridges, trees and small waterfall. Soften and simplify details enough for small UI display. Cream buildings, amber windows, warm caramel rocky underside, golden wood, sage foliage, restrained soft teal roofs and water. Soft morning light, welcoming rounded shapes with delicate illustrated outlines and smooth shaded forms. It must look like a cohesive illustrated island, not a collection of icons.
Keep the entire island including its bottom and horn-roof inside the square frame with a small transparent margin. TRUE TRANSPARENT ALPHA BACKGROUND, clean cutout, no white rectangle, no painted checkerboard, no scene background. No humanoid figures. No text or embedded labels because FREE-BBS is rendered separately in HTML. No gloomy black cliffs, dark gothic industrial look, harsh cyan neon, heavy realism, or surrounding colored aura. Suitable on both light and dark website backgrounds.
```
