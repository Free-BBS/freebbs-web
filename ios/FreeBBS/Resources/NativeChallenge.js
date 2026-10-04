(() => {
  if(location.pathname!=='/circuit-challenge'||!document.documentElement.classList.contains('freebbs-native-lab'))return;
  const byId=name=>document.getElementById('challenge-'+name);
  let previous='',scheduled,selectedLevel='';
  const enabled=n=>!!n&&!n.disabled&&!n.hidden&&!n.closest('[hidden]');
  function snapshot(){
    scheduled=null;
    const data={title:byId('title')?.textContent||'电路闯关',description:byId('description')?.textContent||'',
      input:byId('input-fact')?.textContent||'',tolerance:byId('tolerance')?.textContent||'',reward:byId('reward')?.textContent||'',
      count:byId('component-count')?.textContent||'',result:byId('result-title')?.textContent||'',status:byId('global-status')?.textContent||byId('run-status')?.textContent||'',
      canRun:enabled(byId('run')),canSubmit:enabled(byId('submit')),canNext:enabled(byId('next')),
      levels:Array.from(byId('level-list')?.querySelectorAll('[data-challenge-id]')||[]).map(n=>({id:n.dataset.challengeId,title:n.querySelector('strong')?.textContent||n.textContent,detail:n.querySelector('small')?.textContent||'',disabled:n.disabled})),
      parts:Array.from(byId('palette')?.querySelectorAll('[data-add]')||[]).map(n=>({id:n.dataset.add,title:n.textContent.trim()}))};
    const current=byId('level-list')?.querySelector('[aria-current=step]')?.dataset.challengeId||'';
    if(current&&current!==selectedLevel){selectedLevel=current;document.getElementById('circuit-stage')?.dispatchEvent(new Event('freebbs-native-fit'));}
    const raw=JSON.stringify(data);if(raw===previous)return;previous=raw;
    window.webkit?.messageHandlers?.site?.postMessage({type:'challengeState',value:raw}).catch(()=>{});
  }
  function schedule(){if(!scheduled)scheduled=setTimeout(snapshot,100);}
  const main=document.querySelector('.challenge-main');
  if(main)new MutationObserver(schedule).observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','disabled','aria-current']});
  const mobile=window.FreeBbsCircuitMobile;
  if(mobile){const original=mobile.show.bind(mobile);mobile.show=name=>{
    if(name==='parameters'){window.webkit?.messageHandlers?.site?.postMessage({type:'challengeParameters'}).catch(()=>{});schedule();}
    else original(name);
  };}
  window.freebbsChallengeCommand=(name,value)=>{
    if(name==='level'||name==='part'){
      const attr=name==='level'?'challengeId':'add';
      const root=byId(name==='level'?'level-list':'palette');
      const n=Array.from(root?.querySelectorAll('button')||[]).find(n=>n.dataset[attr]===value);if(n&&!n.disabled)n.click();
    }
    schedule();
  };
  snapshot();
})();
