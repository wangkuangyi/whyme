"""Prepare self-hosted fonts; all content subsetting happens locally.

Run again after adding Chinese copy. Font URLs and SHA-256 hashes are recorded.
Only public font-family requests are sent to Google Fonts. No project text is
sent outside this computer. Chinese subsetting uses the installed Noto font.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / 'public/fonts'
LICENSE_DIR = ROOT / 'public/licenses'
FONT_DIR.mkdir(parents=True, exist_ok=True)
LICENSE_DIR.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / '.cache/font-tools'))
LOCAL_ONLY = '--local-only' in sys.argv
previous_manifest = json.loads((FONT_DIR / 'manifest.json').read_text(encoding='utf-8')) if (FONT_DIR / 'manifest.json').exists() else {}
previous_fonts = {f['file']: f for f in previous_manifest.get('fonts', [])}
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=40).read()


text = ''.join(chr(i) for i in range(32, 127))
for file in [ROOT / 'index.html', *list((ROOT / 'src').glob('*.js')), *list((ROOT / 'src').glob('*.css'))]:
    if file.exists():
        text += file.read_text(encoding='utf-8')
text += ('王匡义换个角度看我拖动光环键盘左右切换上一条下一条四个角度四个理由'
         '现在即可到岗简历下载返回关闭邮箱个人网站新加坡杭州学位计算机工程'
         '幕后制作更新日志首版人物模型由生成提供基于骨骼姿态网页采用实时三维渲染'
         '点击继续加载静帧模式减少动态内容全部可访问打印©↗←→⌄●—·，。；：？！“”‘’（）年月日')
# Include the actual Latin letters and digits in the same font as Chinese.
# Also include punctuation from the live source (for example ×, … and ↗),
# rather than leaving those characters to another system font.
ascii_text = ''.join(chr(i) for i in range(32, 127))
subset_text = ''.join(sorted(set(ascii_text + ''.join(c for c in text if ord(c) >= 160))))

families = [
    ('Instrument Serif', 'instrument-serif', [400], True),
    ('Noto Sans SC', 'noto-sans-sc', [400, 600], False),
]
manifest = {'source': 'Local Noto Sans SC / Google Fonts Instrument Serif', 'subset_characters_requested': len(subset_text), 'fonts': []}
css = []
for family, slug, weights, italic in families:
    for weight in weights:
        filename = f'{slug}-{weight}' + ('-italic' if italic else '') + '.woff2'
        if slug == 'noto-sans-sc':
            from fontTools import subset as font_subset
            from fontTools.ttLib import TTFont
            from fontTools.varLib.instancer import instantiateVariableFont
            source = Path('C:/Windows/Fonts/NotoSansSC-VF.ttf')
            font = TTFont(source)
            supported_text = ''.join(c for c in subset_text if ord(c) in font.getBestCmap())
            options = font_subset.Options()
            options.flavor = 'woff2'
            subsetter = font_subset.Subsetter(options=options)
            subsetter.populate(text=supported_text)
            subsetter.subset(font)
            instantiateVariableFont(font, {'wght': weight}, inplace=True)
            font.flavor = 'woff2'
            font.save(FONT_DIR / filename)
            # This verifies actual glyph coverage, not merely CSS family names.
            actual_cmap = TTFont(FONT_DIR / filename).getBestCmap()
            required_text = ascii_text + ''.join(c for c in subset_text if '\u4e00' <= c <= '\u9fff')
            missing = ''.join(c for c in required_text if ord(c) not in actual_cmap)
            if missing:
                raise RuntimeError(f'Missing page glyphs in {filename}: {missing}')
            data = (FONT_DIR / filename).read_bytes()
            source_url = 'Local installed Noto Sans SC; no page text sent externally'
        else:
            if LOCAL_ONLY:
                data = (FONT_DIR / filename).read_bytes()
                source_url = previous_fonts.get(filename, {}).get('url', 'Previously downloaded from Google Fonts')
            else:
                axes = f'ital,wght@1,{weight}' if italic else f'wght@{weight}'
                url = ('https://fonts.googleapis.com/css2?family=' + urllib.parse.quote(family) + ':' + axes + '&display=swap')
                remote_css = fetch(url).decode()
                latin_css = remote_css.split('/* latin */')[-1]
                urls = re.findall(r'url\((https://[^)]+)\)', latin_css)
                if len(urls) != 1:
                    raise RuntimeError(f'Expected one Latin file for {family} {weight}: {latin_css}')
                source_url = urls[0]
                data = fetch(source_url)
        if data[:4] != b'wOF2':
            raise RuntimeError(f'Expected WOFF2 data for {filename}')
        if slug == 'noto-sans-sc' and len(data) > 150 * 1024:
            raise RuntimeError(f'Chinese subset budget exceeded: {len(data)} bytes')
        (FONT_DIR / filename).write_bytes(data)
        css.append('@font-face {\n'
                   + f'  font-family: "{family}";\n  font-style: {"italic" if italic else "normal"};\n'
                   + f'  font-weight: {weight};\n  font-display: swap;\n'
                   + f'  src: url("/fonts/{filename}") format("woff2");\n' + '}\n')
        manifest['fonts'].append({'file': filename, 'family': family, 'weight': weight, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'url': source_url})
        print(f'{filename}: {len(data)} bytes', flush=True)
    license_slug = slug.replace('-', '')
    license_url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{license_slug}/OFL.txt'
    if not LOCAL_ONLY:
        (LICENSE_DIR / f'{slug}-OFL.txt').write_bytes(fetch(license_url))

(FONT_DIR / 'fonts.css').write_text('\n'.join(css), encoding='utf-8')
(FONT_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Finished: {len(manifest["fonts"])} self-hosted WOFF2 files; {len(subset_text)} requested characters, including Latin and digits.')
