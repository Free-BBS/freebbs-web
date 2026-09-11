# 课程星球素材（v2）

2026-09-05：按现有学科岛屿风格生成课程小星球。仅替换课程层装饰材质；不改变主星球、轨道坐标、课程链接或旋转交互。

生成方式：内置 image_gen 工具，每门课程单独调用；原岛屿图为风格与学科元素参考。生成背景出现实画棋盘格，沿用用户允许的本地背景清理流程，保留 alpha，输出 WebP。

| 课程               | 参考素材             | 输出（public/assets）                                                  |
| ------------------ | -------------------- | ---------------------------------------------------------------------- |
| 高等微积分         | math_island.webp     | course-planet-math-v2.webp / course-planet-math-v2-mobile.webp         |
| 电子电路与系统基础 | circuits_island.webp | course-planet-circuits-v2.webp / course-planet-circuits-v2-mobile.webp |
| 信号与系统         | signals_island.webp  | course-planet-signals-v2.webp / course-planet-signals-v2-mobile.webp   |

主图 768px，窄屏图 512px；使用 contain 保留穹顶、天线、瀑布和课程符号，不再叠加旧真实地形和符号层。旧素材保留，以便回退。

## 最终生成提示词

### math

Use case: stylized-concept. Edit the provided course island into a SINGLE compact spherical tiny planet sprite for the same educational game. Preserve its painterly isometric cartoon 3D diorama style, chunky sculpted rock, miniature scholarly architecture, moss/green vegetation and softly luminous scientific motifs. The planet must read as an approximately round full globe, NOT a flat island slab and NOT a realistic astronomical rock. Elevation details grow around the curved globe, clean readable silhouette at 120px. Three-quarter elevated view, restrained soft light, moderately saturated natural palette. Single subject centered, fills 85% of square canvas, all edges inside frame. Truly transparent background with alpha, no sky, no painted checkerboard, no ground or rectangular backdrop, no cast shadow outside the planet. No UI label, no course name, no logo, no watermark; only the specified mathematical or circuit symbols. No enormous glowing ring crossing the face (the website already supplies an orbit). Course: advanced calculus. Ivory limestone, sage green, muted blue roofs, gold details. Distinct integral-sign stone sculpture ∫, an elegant coordinate grid with smooth function curve, a small domed academy integrated on a round grassy limestone globe. Simplify the source scene into 3 strong motifs. Clearly stylized, warm scholarly game art.

### circuits

Use case: stylized-concept. Edit the provided course island into a SINGLE compact spherical tiny planet sprite for the same educational game. Preserve its painterly isometric cartoon 3D diorama style, chunky sculpted rock, miniature scholarly architecture, moss/green vegetation and softly luminous scientific motifs. The planet must read as an approximately round full globe, NOT a flat island slab and NOT a realistic astronomical rock. Elevation details grow around the curved globe, clean readable silhouette at 120px. Three-quarter elevated view, restrained soft light, moderately saturated natural palette. Single subject centered, fills 85% of square canvas, all edges inside frame. Truly transparent background with alpha, no sky, no painted checkerboard, no ground or rectangular backdrop, no cast shadow outside the planet. No UI label, no course name, no logo, no watermark; only the specified mathematical or circuit symbols. No enormous glowing ring crossing the face (the website already supplies an orbit). Course: electronic circuits and system fundamentals. Deep emerald PCB globe with copper-gold traces wrapping around its curved surface, stone rocky understructure and small patches of moss; a chunky inductor coil, capacitor towers, and triangular op-amp symbol (+ and −) as compact game architecture. Source island's green/copper/cream colors and tactile cartoony handcrafted details. Three strong motifs, no dense labels.

### signals

Use case: stylized-concept. Edit the provided course island into a SINGLE compact spherical tiny planet sprite for the same educational game. Preserve its painterly isometric cartoon 3D diorama style, chunky sculpted rock, miniature scholarly architecture, moss/green vegetation and softly luminous scientific motifs. The planet must read as an approximately round full globe, NOT a flat island slab and NOT a realistic astronomical rock. Elevation details grow around the curved globe, clean readable silhouette at 120px. Three-quarter elevated view, restrained soft light, moderately saturated natural palette. Single subject centered, fills 85% of square canvas, all edges inside frame. Truly transparent background with alpha, no sky, no painted checkerboard, no ground or rectangular backdrop, no cast shadow outside the planet. No UI label, no course name, no logo, no watermark; only the specified mathematical or circuit symbols. No enormous glowing ring crossing the face (the website already supplies an orbit). Course: signals and systems. Muted blue-violet stone globe with teal grassy terraces; glowing cyan sine wave sculpture, a small stepped frequency-spectrum crystal array and a miniature satellite dish. Preserve source island's blues/cyans/violets with restrained glow and visible stone, clean round globe beneath architecture. Three strong recognizable motifs, no dense labels.
