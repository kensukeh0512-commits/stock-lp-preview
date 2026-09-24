# 画像素材メモ（ChatGPT生成）

LP内の写真素材は **ChatGPT（GPT Image）で生成済み**で、すでに `assets/img/` に実装されています。
このファイルは、差し替え・追加生成するときのための記録です。

---

## 実装済みの4点

| ファイル | 使用箇所 | サイズ | 容量 |
|---|---|---|---|
| `hero-bg.jpg` | ファーストビュー背景（CSS） | 1400×1050 | 147KB |
| `problem-bg.jpg` | 「こんなお悩み、ありませんか？」見出し（文字焼き入れ） | 1400×1050 | 68KB |
| `ai-bg.jpg` | 「4,000社→5銘柄」スクリーニング図（文字焼き入れ） | 1200×900 | 202KB |
| `cta-bg.jpg` | 最終CTAセクション背景（CSS） | 1400×1050 | 139KB |

合計 約554KB。ヒーローのみ `preload`、他は `loading="lazy"`。

### 文字の扱いについて
画像生成モデルは**日本語の長文を正確に描けない**ため、訴求コピーは画像に焼き込ませていません。
代わりに、**写真の上にSVGテキストを重ねて1枚の画像として合成**しています（`.shot` / `.shot-tx`）。
見た目は焼き入れ画像と同一で、かつ文字が絶対に崩れません。差し替え時もこの構造を維持してください。

---

## 実際に使用したプロンプト

### 1. hero-bg.jpg
```
Create a cinematic background image for a premium Japanese stock-investment landing page.
Deep navy-black background (#070b14 to #0f1626), glowing metallic gold candlestick chart
rising steeply from lower-left to upper-right, faint holographic perspective grid lines,
soft particle bokeh, subtle volumetric light rays from above, very high contrast, luxurious,
serious and trustworthy mood. CRITICAL: absolutely no text, no letters, no numbers, no logos,
no watermark anywhere in the image. Keep the central area darker and uncluttered so that large
typography can be overlaid later. Photorealistic 3D render, 8k, sharp focus. Aspect ratio 4:3.
```

### 2. cta-bg.jpg
```
A cinematic photograph: a lone silhouetted figure seen from behind, stepping forward out of
deep navy-black darkness into a warm golden beam of light. One foot lifted mid-stride.
Dramatic volumetric backlighting, glowing gold particles in the air, reflective dark floor.
Hopeful, decisive, premium mood. Color palette: deep navy-black #070b14 and metallic gold #d4af37.
CRITICAL: absolutely no text, no letters, no numbers, no logos, no watermark. No visible face.
Photorealistic, cinematic 8k, sharp focus. Aspect ratio 4:3.
```

### 3. ai-bg.jpg
```
Abstract visualization of an AI analyzing thousands of stock tickers. Thousands of tiny glowing
data points and light streaks converging from a wide field into one concentrated brilliant gold
beam, funnel-shaped convergence, deep navy-black background #070b14, metallic gold #d4af37 and
white light, faint holographic grid, elegant minimal premium 3D render, sense of precision and
intelligence. CRITICAL: absolutely no text, no letters, no numbers, no logos, no watermark.
Cinematic 8k, sharp focus. Aspect ratio 4:3.
```

### 4. problem-bg.jpg
```
A cinematic photograph of a Japanese man in his 40s sitting alone at a desk late at night,
seen from a low three-quarter angle, looking down at a smartphone with a worried, exhausted
expression. Cold blue-grey moody lighting, dark room, faint glow from the phone screen on his
face, shallow depth of field, quiet and heavy atmosphere. Leave the right third of the frame
dark and empty for text. CRITICAL: absolutely no text, no letters, no numbers, no logos,
no watermark. Photorealistic, cinematic 8k. Aspect ratio 4:3.
```

---

## 追加で生成するなら（未実装）

### 監修者ビジュアル
> ⚠️ 実在の監修者がいる場合は**必ず本人写真**を使ってください。生成画像を実在の人物として提示するのは景表法上きわめて危険です。イメージ写真として使う場合も「※イメージです」の明記を必須に。

```
Portrait of a confident Japanese man in his 40s wearing a dark navy tailored suit, standing in
a modern trading floor at night, multiple monitors with gold-toned charts blurred in the
background, cinematic rim lighting, serious and trustworthy expression, photorealistic,
shallow depth of field, no text.
```

### 時代背景セクションの背景テクスチャ
```
A horizontal luxury banner texture: deep black background with fine diagonal metallic gold
brushed lines, subtle light sweep across the center, premium award-ceremony feel, 16:9, no text.
```

---

## 共通スタイル指定（新規生成時に末尾へ付ける）

```
Style: premium Japanese financial service landing page, deep navy-black background
(#070b14 to #0f1626), metallic gold accents (#d4af37 / #f3dd92), crimson accent (#e0342a),
cinematic lighting, high contrast, clean and trustworthy, no text, no watermark, no logo,
photorealistic, 8k, sharp focus.
```

## 差し替え手順

1. ChatGPTで生成 → ダウンロード
2. リサイズ・圧縮（横1400px / JPEG品質82 / progressive）
   ```bash
   python -c "from PIL import Image; im=Image.open('src.jpg').convert('RGB'); w=1400; im.resize((w,round(w*im.height/im.width)),Image.LANCZOS).save('assets/img/hero-bg.jpg','JPEG',quality=82,optimize=True,progressive=True)"
   ```
3. `assets/img/` の同名ファイルに上書き
4. 文字の位置がずれる場合は `index.html` 内の `.shot-tx` の `<text x= y=>` を調整（viewBox は 640×480）
