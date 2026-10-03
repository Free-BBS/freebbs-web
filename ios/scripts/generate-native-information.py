#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[2]
import argparse,subprocess
parser=argparse.ArgumentParser()
parser.add_argument("--check",action="store_true")
args=parser.parse_args()
class Reader(HTMLParser):
 def __init__(self): super().__init__(); self.main=False;self.block=None;self.chunks=[];self.links=[];self.blocks=[]
 def handle_starttag(self,tag,attrs):
  if tag=='main':self.main=True
  if not self.main:return
  if tag in ['h1','h2','h3','h4','p','li','dt','dd'] and self.block is None:self.block=tag;self.chunks=[];self.links=[]
  if tag=='a' and self.block:
   href=dict(attrs).get('href','')
   if href.startswith('/') and not href.startswith('/development'):self.links.append(href)
 def handle_data(self,data):
  if self.main and self.block:self.chunks.append(data)
 def handle_endtag(self,tag):
  if self.block==tag:
   content=re.sub(r'\s+',' ',''.join(self.chunks)).strip()
   if content:self.blocks.append({'kind':tag,'text':content,'links':self.links})
   self.block=None
  if tag=='main':self.main=False
pages={}
for path in ['about','guide','creative-workshop','pbl']:
 p=Reader();p.feed((root/'public'/f'{path}.html').read_text());pages['/'+path]=p.blocks
guide=json.loads(subprocess.check_output(["node","-e","const g=require('./public/max-guide-stations.js'),r=require('./public/max-guide-releases.js');console.log(JSON.stringify({version:r.GUIDE_VERSION,steps:g.STEPS.map(({id,station,route,label,title,body,caption})=>({id,station,route,label,title,body,caption}))}))"],cwd=root,text=True))
outputs={"NativeInformation.json":json.dumps(pages,ensure_ascii=False,indent=2)+"\n", "StaffRoster.json":(root/"public/data/staff.json").read_text(), "NativeGuide.json":json.dumps(guide,ensure_ascii=False,indent=2)+"\n"}
for name,content in outputs.items():
 out=root/"ios/FreeBBS/Resources"/name
 if args.check:
  if not out.exists() or out.read_text()!=content: raise SystemExit(f"Native information drift: {name}; regenerate with ios/scripts/generate-native-information.py")
 else: out.write_text(content)
print("Native information verified" if args.check else "Native information generated")
