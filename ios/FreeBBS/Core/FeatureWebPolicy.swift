import Foundation

enum FeatureWebPolicy {
    static func session(origin: URL, token: String?, dark: Bool, preferences: [String: String] = [:], preferenceKeys: [String] = Array(WebPreferences.keys)) -> String {
        """
        (() => {
          if (location.origin !== new URL(\(WebContentPolicy.json(origin.absoluteString))).origin) return;
          \(FeatureCatalog.navigationScript)
          if (!nativePageAllowed) return;
          const initialToken = \(WebContentPolicy.json(token ?? ""));
          if (initialToken) localStorage.setItem('free_bbs_auth_token',initialToken);
          else localStorage.removeItem('free_bbs_auth_token');
          const savedPreferences = \(WebContentPolicy.json(preferences));
          if (localStorage.getItem('freebbs_native_preferences_seeded') !== '1') {
            for (const [key,value] of Object.entries(savedPreferences)) localStorage.setItem(key,value);
            localStorage.setItem('freebbs_native_preferences_seeded','1');
          }
          if (!localStorage.getItem('free_bbs_theme_mode')) localStorage.setItem('free_bbs_theme_mode',\(WebContentPolicy.json(dark ? "dark" : "light")));
          document.documentElement.classList.add('freebbs-native-feature');
          const send = body => window.webkit.messageHandlers.site.postMessage(body);
          const navigationChanged = () => send({type:'location',url:location.href}).catch(()=>{});
          for (const name of ['pushState','replaceState']) {
            if (!window.history?.[name]) continue;
            const original = window.history[name];
            window.history[name] = function(...args) { const result = original.apply(this,args); navigationChanged(); return result; };
          }
          window.addEventListener?.('popstate',navigationChanged);
          const preferenceKeys = \(WebContentPolicy.json(preferenceKeys));
          const originalSet = Storage.prototype.setItem, originalRemove = Storage.prototype.removeItem;
          Storage.prototype.setItem = function(key,value) {
            const previous = this.getItem(key); originalSet.call(this,key,value);
            if (this === localStorage && key === 'free_bbs_auth_token' && previous !== String(value)) send({type:'session',token:String(value)}).catch(()=>{});
            else if (this === localStorage && preferenceKeys.includes(key) && previous !== String(value)) send({type:'preference',key,value:String(value)}).catch(()=>{});
          };
          Storage.prototype.removeItem = function(key) {
            const existed = this.getItem(key); originalRemove.call(this,key);
            if (this === localStorage && key === 'free_bbs_auth_token' && existed) send({type:'logout'}).catch(()=>{});
            else if (this === localStorage && preferenceKeys.includes(key)) send({type:'preference',key,value:null}).catch(()=>{});
          };
          // Only a data-sending AI operation asks for consent; ordinary browsing
          // and fetching model/dialog metadata never show another prompt.
          const originalFetch = window.fetch.bind(window), activeAI = new Set();
          window.freebbsNativeCancelAI = () => { for (const controller of activeAI) controller.abort(); activeAI.clear(); };
          window.fetch = async function(input,init) {
            const url = new URL(input instanceof Request ? input.url : String(input),location.href);
            const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
            const aiMetadata = url.pathname === '/api/ai/dialogs' || url.pathname.startsWith('/api/ai/dialogs/') ||
              url.pathname === '/api/ai/info/jobs/get' || new RegExp('^/api/ai/tasks/[^/]+/(presence|acknowledge|cancel)$').test(url.pathname);
            const ai = url.origin === location.origin && method !== 'GET' && method !== 'HEAD' &&
              ((!aiMetadata && url.pathname.startsWith('/api/ai/')) || url.pathname.startsWith('/api/tools/generate/') ||
                url.pathname === '/api/workbench/schedule-planner/preview');
            let options = init;
            if (ai) {
              const allowed = await send({type:'consent'});
              if (!allowed) throw new DOMException('已取消 Max 数据发送。','AbortError');
              const controller = new AbortController(); activeAI.add(controller);
              const callerSignal = init?.signal || (input instanceof Request ? input.signal : null);
              options = {...init,signal:callerSignal ? AbortSignal.any([callerSignal,controller.signal]) : controller.signal};
            }
            const response = await originalFetch(input,options);
            if (url.origin === location.origin && response.ok && method === 'POST' && url.pathname === '/api/workbench/connectors/tsinghua/authorization-attempts') {
              const attempt = await response.clone().json();
              if (typeof attempt.authorizationUrl === 'string') await send({type:'authorization',url:attempt.authorizationUrl});
            }
            if (url.origin === location.origin && response.ok && method !== 'GET' && url.pathname.startsWith('/api/profile')) send({type:'profileChanged'}).catch(()=>{});
            return response;
          };
        })();
        """
    }

    static let mobile = """
    (() => {
      if (!document.documentElement.classList.contains('freebbs-native-feature')) return;
      const style = document.createElement('style');
      style.textContent = `
        html.freebbs-native-feature { --font-ui:-apple-system,BlinkMacSystemFont,sans-serif; --mobile-nav-space:0px; }
        html.freebbs-native-feature body { margin:0!important; padding:0!important; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
        html.freebbs-native-feature :is(.topbar,.mobile-nav,.mobile-tools,.desktop-shell-rail,.mobile-header-backdrop,.site-footer,.max-guide-launcher,.max-guide-reopen) { display:none!important; }
        html.freebbs-native-feature :is(body>.sidebar,.page-shell>.sidebar) { display:none!important; }
        html.freebbs-native-feature :is(.page-shell,.dashboard-shell) { margin:0!important; padding:0!important; min-height:100dvh!important; }
        html.freebbs-native-feature .main-content { width:100%!important; max-width:100%!important; margin:0!important; padding:16px!important; box-sizing:border-box; }
        html.freebbs-native-feature body:not(.auth-page-body) .main-content::before { display:none!important; content:none!important; }
        html.freebbs-native-feature body.world-page :is(.world-explorer,.island-course-stage) { padding:16px 0 24px!important; min-height:0!important; }
        html.freebbs-native-feature body.ranch-gallery-page .community-heading { top:16px!important; left:16px!important; right:16px!important; flex-wrap:wrap; gap:8px; }
        html.freebbs-native-feature :is(.settings-shell,.workbench-shell,.admin-directory-shell,.survey-shell,.site-info-shell,.markdown-editor-shell) { max-width:100%!important; width:100%!important; min-width:0!important; }
        html.freebbs-native-feature :is(.settings-grid,.workbench-grid,.workbench-form-grid,.workbench-dashboard-grid,.workbench-campus-courses-layout,.inventory-layout,.profile-layout,.electromagnetic-layout,.markdown-editor-layout) { grid-template-columns:minmax(0,1fr)!important; }
        html.freebbs-native-feature :is(input,textarea,select) { font-size:16px!important; max-width:100%; box-sizing:border-box; }
        html.freebbs-native-feature :is(input:not([type=checkbox]):not([type=radio]),select) { min-height:44px; }
        html.freebbs-native-feature :is(button,.button,[role=button]) { min-height:44px; touch-action:manipulation; }
        html.freebbs-native-feature :is(.form-actions,.settings-actions,.workbench-actions,.survey-actions) { flex-wrap:wrap; gap:10px; }
        html.freebbs-native-feature :is(pre,.native-table-scroll,.markdown-preview) { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        html.freebbs-native-feature :is(dialog,[role=dialog]) { max-width:calc(100vw - 24px); max-height:calc(100dvh - 24px); box-sizing:border-box; }
        html.freebbs-native-feature :is(.knowledge-document,.knowledge-document-content,.markdown-preview) { overflow-wrap:anywhere; }
        html.freebbs-native-feature .discussion-layout { grid-template-columns:minmax(0,1fr)!important; }
        html.freebbs-native-feature .discussion-sidebar { position:static!important; width:100%!important; }
        html.freebbs-native-feature :is(.discussion-filters,.discussion-board-tabs) { display:flex; overflow-x:auto; flex-wrap:nowrap; }
        html.freebbs-native-feature :is(.discussion-filters,.discussion-board-tabs)>* { flex-shrink:0; }
        @media(max-width:600px) {
          html.freebbs-native-feature :is(h1,.page-title) { font-size:26px; line-height:1.3; }
          html.freebbs-native-feature :is(.settings-tabs,.workbench-tabs,.inventory-tabs) { flex-wrap:nowrap; overflow-x:auto; }
        html.freebbs-native-feature :is(.settings-tabs,.workbench-tabs,.inventory-tabs)>* { flex-shrink:0; }
          html.freebbs-native-feature .markdown-editor-header { padding:16px!important; gap:12px; }
          html.freebbs-native-feature .markdown-editor-header h1 { font-size:22px; }
          html.freebbs-native-feature .markdown-section-tabs { display:flex!important; flex-wrap:nowrap!important; gap:8px; overflow-x:auto; }
          html.freebbs-native-feature .markdown-section-tabs button { flex:0 0 auto; min-width:96px; padding:10px 12px!important; }
          html.freebbs-native-feature .markdown-section-tabs button small { display:none; }
          html.freebbs-native-feature .markdown-toolbar { flex-wrap:nowrap!important; overflow-x:auto; }
          html.freebbs-native-feature .markdown-toolbar button { flex-shrink:0; }
          html.freebbs-native-feature .markdown-workspace { grid-template-columns:minmax(0,1fr)!important; }
          html.freebbs-native-feature .markdown-source-panel textarea { min-height:200px; height:40dvh; width:100%; }
          html.freebbs-native-feature :is(.guide-primary,.course-map-actions button,.is-primary,button[type=submit]) { background:#067b7f!important; color:#fff!important; }
        }
      `;
      document.head.append(style);
      const normalize = () => {
        if (document.body.classList.contains('has-mobile-header')) document.body.classList.remove('has-mobile-header');
        for (const node of document.querySelectorAll('.topbar,.mobile-nav,.mobile-tools,.desktop-shell-rail,.mobile-header-backdrop,.site-footer,.max-guide-launcher,.max-guide-reopen,body>.sidebar,.page-shell>.sidebar,.app-shell>.sidebar')) {
          if (node.style.getPropertyValue('display') !== 'none' || node.style.getPropertyPriority('display') !== 'important') node.style.setProperty('display','none','important');
        }
        for (const main of document.querySelectorAll('.main-content')) {
          const scene = document.body.matches('.ranch-gallery-page,.ranch-page');
          for (const [key,value] of Object.entries({margin:'0',padding:scene ? '0' : '16px',width:'100%',...(scene ? {inset:'0',height:'100dvh','min-height':'0'} : {})})) main.style.setProperty(key,value,'important');
        }
        // Remove excluded destinations even when website scripts add links later.
        for (const link of document.querySelectorAll('a[href]')) {
          let url;try { url = new URL(link.href,location.href); } catch { continue; }
          if (url.origin === location.origin && (url.pathname === '/development' || url.pathname === '/development.html' || url.pathname.startsWith('/development/'))) link.remove();
        }
        for (const table of document.querySelectorAll('main table')) {
          if (table.parentElement.classList.contains('native-table-scroll')) continue;
          const scroll = document.createElement('div');scroll.className='native-table-scroll';
          table.before(scroll);scroll.append(table);
        }
      };
      normalize();new MutationObserver(normalize).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    })();
    """
}
