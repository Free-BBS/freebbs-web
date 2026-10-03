# 绵羊与知识轨道图标

当前应用图标源为 `../../FreeBBS/Resources/FreeBBSIcon.icon/`，原生 Icon Composer 文档包含两组图层：前景绵羊 PNG、背景知识轨道 SVG。背景、深色外观、玻璃光照和阴影由 Icon Composer 配置；没有在源文件中预裁剪系统圆角。

`sheep-orbit-concept.png` 是 AI 概念图，`sheep-orbit-light.png`、`sheep-orbit-dark.png`、`sheep-orbit-tinted.png` 与 `sheep-orbit-small.png` 是 Apple 原生 `ictool` 的 iOS 27 渲染结果，分别用于浅色、深色、着色和 60 pt 小尺寸检查。Xcode 27 已将 `.icon` 编译为实际主图标 `FreeBBSIcon`。旧资产目录的 `AppIcon` 保留为历史资源，未作为主图标。

生成方式：内置 image_gen；未使用 CLI/API fallback。生成文件保留原件，选用的 PNG 已复制到工程中。知识轨道使用独立的 SVG 图层，便于调整粗细和位置。

## 最终前景生成提示词

Use case: precise-object-edit. Asset type: 1024 by 1024 transparent foreground layer for an Apple Icon Composer FREE-BBS iPhone app icon. Edit the supplied sheep icon. Preserve the exact friendly front-facing sheep identity, jade teal leaf-like ears, ivory wool cloud silhouette, dark deep teal oval face and two small ivory round eyes. Remove the entire orbital arc and orbital dot, remove background completely. Make it a crisp clean flat vector-style mark with smooth opaque solid-color fills, no baked specular highlights, no shadows, no bevels, no gradients, no texture, no 3D rendering: Icon Composer will add the native glass material. Center the sheep horizontally and vertically in a 1024px square canvas, sheep including ears occupying about 70 percent of canvas width and 56 percent of canvas height. Use 5 or 6 broad rounded wool lobes, a very subtly pointed bottom center like the book in the reference. Premium restrained geometry. No text, no letters, no border, no rounded-square background. Actual alpha transparency outside sheep.

参考图：`sheep-orbit-concept.png`。模型实际返回 1254×1254 带 alpha 的 PNG，使用 Icon Composer 的原生 position scale 0.78 调整到画布安全区域，未另行缩放或修改位图。原生预览确认耳朵完整、轨道位于羊后方，着色外观保留脸和眼睛的对比。

## 重新渲染

```sh
ICON_TOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
"$ICON_TOOL" ios/FreeBBS/Resources/FreeBBSIcon.icon --export-image \
  --output-file ios/Design/Icons/sheep-orbit-light.png --platform iOS \
  --rendition Default --width 1024 --height 1024 --scale 1 --design-generation 27
```

可将 rendition 改为 `Dark` 或 `TintedDark`。着色预览增加 `--tint-color 0.43 --tint-strength 0.7`。预览中的系统蒙版透明区域由工具生成，不用于上传单张商店图标；Archive 使用 `.icon` 源。

参考 Apple [Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer) 与 [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons/)。
