#!/usr/bin/env python3
"""Offline preview uses the same website sheep and timer engines, never site APIs."""
from pathlib import Path
import base64, json, sys
root=Path(__file__).resolve().parents[2]
public=root/'public'
style='\n'.join((public/p).read_text() for p in ['profile-extras.css','ranch-page.css','ranch-study.css'])
scripts='\n'.join((public/p).read_text() for p in ['max-ranch.js','ranch-design-data.js','ranch-design.js'])
photos={scene:'data:image/webp;base64,'+base64.b64encode((public/'assets/ranch'/('autumn.webp' if scene=='meadow' else scene+'/autumn.webp')).read_bytes()).decode() for scene in ['meadow','lake','courtyard','wall']}
html='''<!doctype html><html lang="zh-CN" class="freebbs-native-feature"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-ui:-apple-system,BlinkMacSystemFont,sans-serif;--ui-text:#21372c;--ui-muted:#506555;--ui-surface:white;}body{margin:0;}''' + style + '''</style><body class="public-profile-page ranch-page theme-light"><div class="page-shell"><main class="main-content"><section class="settings-shell"><section class="ranch-stage"><section id="public-profile-ranch" class="profile-ranch ranch-photographic"><div class="ranch-scene"><div class="ranch-scenery"></div><div class="ranch-pet-track"><div data-max-actor></div></div><div class="ranch-scene-heading"><p data-season-caption>北京 · 秋 · 示例场景</p>''' + ''.join(f'<button data-ranch-scene-choice="{s}">{s}</button>' for s in photos)+'''</div><button data-ranch-pause aria-pressed="false">暂停动态</button></div></section></section></section></main></div><script>''' + scripts.replace('</script','<\\/script') + '''\nconst photos='''+json.dumps(photos)+''';
const scene=document.querySelector('.ranch-scene');
const actor=window.FreeBbsMaxRanch.mount(document.querySelector('[data-max-actor]'),{hungry:false});
window.FreeBbsRanchDesign.apply(document.querySelector('[data-max-actor]'),{version:1,wool:{base:'#f5efe3',layers:[]},face:{base:'#55615b',layers:[]},horns:{}});
function setScene(key){document.body.dataset.ranchScene=key;document.querySelector('#public-profile-ranch').style.setProperty('--ranch-photo',`url("${photos[key]}")`);}
setScene('meadow');document.querySelectorAll('[data-ranch-scene-choice]').forEach(n=>n.addEventListener('click',()=>setScene(n.dataset.ranchSceneChoice)));
document.querySelector('[data-ranch-pause]').addEventListener('click',event=>{const paused=event.currentTarget.getAttribute('aria-pressed')!=='true';event.currentTarget.setAttribute('aria-pressed',String(paused));scene.classList.toggle('is-paused',paused);actor.pause(paused);});
</script><script>'''+(public/'ranch-study.js').read_text().replace('</script','<\\/script')+'''</script></body></html>'''
output=root/'ios/FreeBBS/Resources/RanchPreview.html'
if '--check' in sys.argv:
 if not output.exists() or output.read_text()!=html:raise SystemExit('Ranch preview differs from website sheep/timer sources')
 print('Ranch preview matches website engines and scenery')
else:
 output.write_text(html);print(f'Bundled offline ranch preview: {len(html)} bytes')
