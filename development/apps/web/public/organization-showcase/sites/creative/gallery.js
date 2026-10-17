const links = Array.from(document.querySelectorAll('[data-gallery]'));
if (links.length) {
  const dialog = document.createElement('dialog');
  dialog.className = 'image-viewer';
  dialog.setAttribute('aria-label','作品大图');
  dialog.innerHTML = '<button class="viewer-close" aria-label="关闭">×</button><button class="viewer-prev" aria-label="上一张">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="viewer-next" aria-label="下一张">›</button>';
  document.body.append(dialog);
  let index=0;
  const show = n => {index=(n+links.length)%links.length;const item=links[index];dialog.querySelector('img').src=item.href;dialog.querySelector('img').alt=item.querySelector('img').alt;dialog.querySelector('figcaption').textContent=`${index+1} / ${links.length}`;};
  links.forEach((link,i)=>link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();show(i);dialog.showModal();}));
  dialog.querySelector('.viewer-close').onclick=()=>dialog.close();
  dialog.querySelector('.viewer-prev').onclick=()=>show(index-1);
  dialog.querySelector('.viewer-next').onclick=()=>show(index+1);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}});
}

