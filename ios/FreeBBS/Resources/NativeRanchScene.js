(() => {
  if (!document.documentElement.classList.contains('freebbs-native-feature')) return;
  const personal = document.body.classList.contains('ranch-page');
  const gallery = document.body.classList.contains('ranch-gallery-page');
  if (!personal && !gallery) return;
  const style = document.createElement('style');
  style.textContent = `
    html.freebbs-native-feature body {height:100dvh!important;overflow:hidden!important;}
    html.freebbs-native-feature .main-content {position:fixed!important;inset:0!important;width:100%!important;height:100dvh!important;padding:0!important;overflow:hidden!important;}
    html.freebbs-native-feature :is(.settings-shell,.ranch-stage,.profile-ranch,.ranch-scene,.community-pasture-page,.community-pasture) {height:100%!important;min-height:0!important;margin:0!important;border-radius:0!important;}
    html.freebbs-native-feature :is(.settings-header,.ranch-scene-heading,.ranch-scene-actions,.ranch-scene-pause,[data-ranch-pause],.ranch-scene-status,.ranch-study-enter,.ranch-study-toolbar,.ranch-study-timer-controls,.ranch-study-notice,.ranch-sidebar-backdrop,.community-heading,.community-interaction,.community-corner-links,.ranch-drawer) {display:none!important;}
    html.freebbs-native-feature .ranch-stage {position:absolute!important;inset:0!important;}
    html.freebbs-native-feature :is(#public-profile-message,#economy-message,#profile-extras-message) {display:none!important;}
    html.freebbs-native-feature .ranch-study-readout {top:clamp(24px,7dvh,64px)!important;left:16px!important;right:16px!important;}
    html.freebbs-native-feature .ranch-study-overlay {pointer-events:none!important;}
    html.freebbs-native-feature .ranch-pet-track {bottom:14%!important;}
    html.freebbs-native-feature .is-study-mode [data-max-actor] {width:min(220px,65vw)!important;}
    html.freebbs-native-feature .community-flock {inset:10% 0 0!important;}
    @media(max-height:400px){html.freebbs-native-feature .ranch-study-readout{top:12px!important;}html.freebbs-native-feature .ranch-study-clock time{font-size:40px!important;}html.freebbs-native-feature .ranch-study-focus{margin-top:8px!important;}html.freebbs-native-feature .ranch-study-focus output{font-size:30px!important;}html.freebbs-native-feature .is-study-mode [data-max-actor]{width:140px!important;}}
  `;
  document.head.append(style);
  const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
  const enabled = selector => { const n=document.querySelector(selector);return !!n && !n.disabled && !n.hidden && !n.closest('[hidden]'); };
  let previous='', scheduled;
  function snapshot() {
    scheduled=null;
    const scene=document.querySelector('.ranch-scene');
    const root=document.querySelector('#public-profile-ranch');
    // The native host owns presentation; entering study never requests browser fullscreen.
    if(root){root.requestFullscreen=null;root.webkitRequestFullscreen=null;}
    const duration=document.querySelector('[data-study-duration]');
    const visit=document.querySelector('#community-visit');
    let selectedUid='';try{selectedUid=new URL(visit?.href||location.href).searchParams.get('uid')||'';}catch{}
    const data={ready:personal?!!document.querySelector('[data-study-enter]'):!!document.querySelector('#community-flock'),study:scene?.classList.contains('is-study-mode')||false,
      clock:document.querySelector('[data-study-toggle-clock]')?.getAttribute('aria-pressed')==='true',
      focus:document.querySelector('[data-study-toggle-focus]')?.getAttribute('aria-pressed')==='true',
      minutes:Number(duration?.value)||25,running:duration?.disabled||false,countdown:text('[data-study-countdown]'),
      startTitle:text('[data-study-start]'),caption:text('[data-season-caption]'),
      status:[text('#public-profile-message'),text('#profile-extras-message'),text('#gallery-status'),text('#community-wind-status')].filter(Boolean).join(' · ').slice(0,1000),
      scene:document.querySelector('#community-scene')?.value||document.body.dataset.ranchScene||'meadow',
      paused:scene?.classList.contains('is-paused')||false,feed:enabled('[data-extra-action="feed"]'),greet:enabled('[data-ranch-greet]'),
      selectedName:enabled('#community-visit')?text('#community-selected-name'):'',selectedUid,
      actions:Array.from(document.querySelectorAll('[data-community-action]')).filter(n=>enabled(`[data-community-action="${n.dataset.communityAction}"]`)).map(n=>({id:n.dataset.communityAction,title:n.textContent.trim()})),
      gears:Array.from(document.querySelector('#community-gear')?.options||[]).filter(n=>!n.disabled&&!n.hidden).map(n=>({id:n.value,title:n.textContent})),
      canEquip:enabled('#community-gear'),findMine:enabled('#community-find-mine'),clover:enabled('#community-clover')};
    const raw=JSON.stringify(data);if(raw===previous)return;previous=raw;
    window.webkit?.messageHandlers?.site?.postMessage({type:'ranchScene',value:raw}).catch(()=>{});
  }
  function schedule(){if(!scheduled)scheduled=setTimeout(snapshot,100);}
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','disabled','aria-pressed']});
  const click=selector=>{const n=document.querySelector(selector);if(n&&!n.disabled&&!n.hidden&&!n.closest('[hidden]'))n.click();};
  window.freebbsRanchCommand=(name,value)=>{
    if(name==='study')click(value?'[data-study-enter]':'[data-study-exit]');
    else if(name==='clock'||name==='focus')click(`[data-study-toggle-${name}]`);
    else if(name==='start')click('[data-study-start]');
    else if(name==='reset')click('[data-study-reset]');
    else if(name==='pause')click('[data-ranch-pause]');
    else if(name==='minutes'&&[15,25,45,60].includes(Number(value))){const n=document.querySelector('[data-study-duration]');if(n&&!n.disabled){n.value=String(value);n.dispatchEvent(new Event('change',{bubbles:true}));}}
    else if(name==='scene'&&['meadow','lake','courtyard','wall'].includes(value)){
      if(personal)click(`[data-ranch-scene-choice="${value}"]`);
      else{const n=document.querySelector('#community-scene');if(n){n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}}
    }
    else if(name==='greet')click('[data-ranch-greet]');
    else if(name==='feed')click('[data-extra-action="feed"]');
    else if(name==='findMine')click('#community-find-mine');
    else if(name==='clover')click('#community-clover');
    else if(name==='closeSelection')click('[data-community-close]');
    else if(name==='action'&&['greet','stroll','pet','backflip','bicycle','fly'].includes(value))click(`[data-community-action="${value}"]`);
    else if(name==='gear'&&['walk','bicycle','wing'].includes(value)){const n=document.querySelector('#community-gear');if(n&&!n.closest('[hidden]')&&Array.from(n.options).some(o=>o.value===value&&!o.disabled&&!o.hidden)){n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}}
    schedule();
  };
  snapshot();
})();
