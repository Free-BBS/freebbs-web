# Four ranch locations, automatic seasons and theme-linked daylight

The location picker offers 山野草甸 (meadow), 湖畔林地 (lake), 京郊庭院 (courtyard), and 长城山谷 (wall). Its device-local preference is `freebbs_ranch_scene`. Legacy manual-season preferences are ignored. March–May is spring, June–August summer, September–November autumn, and December–February winter, using Beijing time (UTC+8). The page refreshes this at Beijing midnight and on return from the background.

Light theme renders daytime; dark theme renders nighttime using a cool low-luminance scenery grade and a small moon, without filtering controls. Profile previews use the same selection and environment. Mobile stays within one viewport with scrollable dialogs; desktop fills the content viewport. Desktop sidebar/header and mobile header/footer use blurred copies of the selected scene.

## Artwork provenance and prompt set

Generated with the built-in image generation tool, then converted to 1536px WebP at quality 76 using Sharp. Existing meadow images are reused. Twelve new files live in `public/assets/ranch/{lake,courtyard,wall}/{spring,summer,autumn,winter}.webp`. Each image is independent, not a collage. No raster was manually painted; nighttime is a CSS effect.

Summer base prompt template:

> Photorealistic natural landscape, immersive virtual ranch photographic background, 1536×1024. [SCENE]. Beijing summer, lush green vegetation, blue sky with soft clouds, neutral daylight without visible sun or harsh dramatic shadows. Natural DSLR textures, not oversaturated. Low eye-level camera, horizon near 45%, broad clear grassy lower foreground for a separately rendered sheep. Important scenery stays recognizable in the central vertical third on a phone. No people, animals, text, UI, watermark or collage. One continuous photograph.

Scene substitutions:

- Lake: tranquil lake in Beijing's rural northern foothills, distant tree-lined shore and low mountains, reeds at edges; entire lower 45% is dry grassy bank, water behind the bank.
- Courtyard: quiet rural Beijing garden, modest grey brick walls and tiled farmhouse on distant sides, old scholar tree, partly grassy weathered paving; broad empty grass lawn across lower 45%; no palace or fantasy architecture.
- Wall: valley at the foot of Beijing's Great Wall, grey stone wall and one watchtower following the distant central ridge, low trees; broad flat meadow across lower 45%, wall not dominating.

Seasonal edit prompt, using the respective summer image as reference:

> Edit this photograph to [SEASON]. Preserve camera, terrain, horizon, buildings, wall, shoreline and tree placement, with clear open foreground. Soft neutral daytime, realistic Beijing countryside. No animals, people, text, UI, collage or watermark. Single continuous landscape photograph.

Season substitutions:

- Spring: tender light green leaves, a few distant pale pink peach blossoms and fresh short grass.
- Autumn: golden grass, ochre/russet foliage, golden leaves and clear pale blue sky.
- Winter: thin natural snow on grass and distant roofs/mountains, bare deciduous trees, cold clear sky; lake partly frozen where present.

## Verification

Unit coverage includes Beijing season boundaries, midnight scheduling, invalid/unavailable storage, automatic theme synchronization, profile isolation, all 16 assets, mobile scroll locking, accessible controls and unchanged purchasing contracts. Browser checks cover four locations in both themes at desktop, narrow phone, tablet and landscape sizes, plus scene persistence, legacy-season migration, modal layout and time rollover.
