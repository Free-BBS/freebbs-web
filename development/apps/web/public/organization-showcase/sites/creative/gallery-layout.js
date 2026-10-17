// Compact, mixed-orientation layouts with stable, irregular positioning.
function arrangeGallery(ratios, width, free) {
  const inset=Math.max(12,width*.035),gap=free?10:16;
  const columns=width<440?2:(free||width>780?3:2);
  const columnWidth=(width-2*inset-gap*(columns-1))/columns;
  const levels=Array(columns).fill(inset);
  const sizes=free?[1,.87,1.1,.94,1.06,.9]:[.96,.84,1,.9,.98,.87];
  const angles=free?[-7,5,-3,8,-5,4]:[-1.8,1.2,-.7,2,-1.4,.6];
  const result=ratios.map((ratio,i)=>{
    ratio=Math.max(.03,ratio||1);
    const span=ratio>1.85&&columns>2?2:1;
    let column=0,level=Infinity;
    for(let c=0;c<=columns-span;c++){
      const candidate=Math.max(...levels.slice(c,c+span));
      if(candidate<level){level=candidate;column=c;}
    }
    const available=columnWidth*span+gap*(span-1);
    let w=Math.min(available*sizes[i%sizes.length],available*(free?1.06:1));
    let h=w/ratio;
    const maxHeight=width*(free?.64:.85);
    if(h>maxHeight){h=maxHeight;w=h*ratio;}
    const angle=angles[i%angles.length],r=Math.abs(angle)*Math.PI/180;
    const boundingW=w*Math.cos(r)+h*Math.sin(r),boundingH=h*Math.cos(r)+w*Math.sin(r);
    let x=inset+column*(columnWidth+gap)+(available-w)*[.15,.85,.45][i%3];
    x=Math.max((boundingW-w)/2+3,Math.min(x,width-w-(boundingW-w)/2-3));
    const y=level+(boundingH-h)/2;
    const next=level+boundingH+(free?-Math.min(24,h*.12):gap);
    for(let c=column;c<column+span;c++)levels[c]=next;
    return {x,y,width:w,height:h,angle};
  });
  return {items:result,height:Math.max(...result.map(p=>p.y+p.height+Math.abs(Math.sin(p.angle*Math.PI/180))*p.width/2),0)+inset+10};
}
if(typeof module!=='undefined')module.exports=arrangeGallery;
function arrangeOrdered(ratios,width){
  const inset=10,gap=12,available=width-inset*2,result=[];
  let y=10,start=0;
  while(start<ratios.length){
    let end=start,sum=0;
    while(end<ratios.length){sum+=ratios[end];end++;if((available-gap*(end-start-1))/sum<Math.min(260,width*.48)||end-start>=4)break;}
    const height=(available-gap*(end-start-1))/sum;
    let x=inset;
    for(let i=start;i<end;i++){const w=ratios[i]*height;result.push({x,y,width:w,height,angle:0});x+=w+gap;}
    y+=height+gap;start=end;
  }
  return {items:result,height:y};
}
if(typeof document!=='undefined')document.querySelectorAll('.year-gallery,.free-gallery').forEach(gallery=>{
  const items=Array.from(gallery.children);
  let pending=false;
  const layout=()=>{
    pending=false;
    const width=gallery.clientWidth;if(!width)return;
    const portraits=[],landscapes=[];
    items.forEach(item=>{const img=item.querySelector('img');const ratio=img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:1;(ratio<.95?portraits:landscapes).push({item,ratio});});
    const mixed=[];
    const ordered=gallery.hasAttribute('data-preserve-order');
    if(ordered){items.forEach(item=>{const img=item.querySelector('img');mixed.push({item,ratio:img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:1});});}
    else while(portraits.length||landscapes.length){if(landscapes.length)mixed.push(landscapes.shift());if(portraits.length)mixed.push(portraits.shift());}
    const arranged=arrangeGallery(mixed.map(x=>x.ratio),width,gallery.classList.contains('free-gallery'));
    gallery.classList.add('layout-scattered');gallery.style.height=arranged.height+'px';
    arranged.items.forEach((p,i)=>{const item=mixed[i].item;item.style.width=p.width+'px';item.style.height=p.height+'px';item.style.left=p.x+'px';item.style.top=p.y+'px';item.style.setProperty('--scatter-angle',p.angle+'deg');item.style.zIndex=String([2,5,1,4,6,3][i%6]);});
  };
  const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(layout);}};
  items.forEach(item=>{const img=item.querySelector('img');img.addEventListener('load',schedule);img.addEventListener('error',schedule);});
  let lastWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-lastWidth)>.5){lastWidth=width;schedule();}}).observe(gallery);
  schedule();
});
