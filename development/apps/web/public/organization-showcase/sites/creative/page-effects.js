// A query parameter keeps each color preview consistent while following links.
const previewPalette = new URLSearchParams(location.search).get('palette');
const previewFont = new URLSearchParams(location.search).get('font');
document.documentElement.dataset.palette=previewPalette==='gray'?'gray':'current';
document.documentElement.dataset.font=previewFont==='kai'?'kai':'current';
document.addEventListener('DOMContentLoaded',()=>{
  if(previewPalette==='gray'||previewPalette==='current'||previewFont==='kai'||previewFont==='current'){
    document.querySelectorAll('a[href]').forEach(link=>{
      const target=new URL(link.getAttribute('href'),location.href);
      if(target.origin===location.origin && /\.html$/.test(target.pathname) && !link.getAttribute('href').startsWith('#')){
        if(previewPalette==='gray'||previewPalette==='current')target.searchParams.set('palette',previewPalette);
        if(previewFont==='kai'||previewFont==='current')target.searchParams.set('font',previewFont);
        link.href=target.href;
      }
    });
  }
});
window.addEventListener('pageshow',event=>{
  if(event.persisted){document.body.classList.remove('page-arrival');void document.body.offsetWidth;document.body.classList.add('page-arrival');}
});
