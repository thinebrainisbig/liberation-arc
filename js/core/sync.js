/* ============================================================
   js/core/sync.js — Step 3, Session 1 (Foundation)

   Loaded FIRST on every page, before js/core.js and everything
   else, so the Storage.prototype wrap below is in place before
   any other script touches localStorage.

   Off by default: everything here is inert until lasync_server
   holds a server URL (set via Connect in the Sync panel). With
   it unset, every localStorage write behaves exactly as it did
   before this file existed.

   This session only builds the foundation: the on/off switch,
   a device ID, the never-sync list, write capture into a queue,
   the status dot and the Sync panel's Connect/Disconnect flow.
   Push, pull, live updates and the daily-job gate are Session 2
   and Session 3 work — nothing here sends la_ data anywhere yet.
============================================================ */
(function(){
  'use strict';

  /* ---------- Local bookkeeping keys (outside la_, so none of
     this ever syncs itself) ----------
     lasync_server   — server URL; sync is off when absent
     lasync_device   — random ID for this browser/app instance
     lasync_email    — last-used email, prefilled in the panel
     lasync_meta     — { [key]: { t: lastLocalChangeMs } }
     lasync_queue    — array of la_ keys waiting to be pushed
     lasync_cursor   — server time of the last pull (Session 2)
     lasync_last_sync — ms timestamp of the last successful sync
                        (Session 2+; read-only here)
     pocketbase_auth — the PocketBase SDK's own auth token store
  */

  /* Never sync: logins (expire, belong to one device), caches
     (rebuilt automatically) and this-device-only settings
     (decided in Step 2). Everything else starting with la_
     syncs by default. */
  var NEVER_SYNC_KEYS = [
    'la_gcal_token', 'la_spotify_auth', 'la_spotify_verifier', 'la_youtube_token',
    'la_weather_cache', 'la_youtube_playlists',
    'la_spotify_volume', 'la_youtube_volume', 'la_spotify_shuffle_mode',
    'la_weather_location', 'la_weather_view_mode', 'la_calendar_time_filter',
    'la_notepad_sidebar_collapsed'
  ];

  function isSyncableKey(key){
    return !!key && key.indexOf('la_') === 0 && NEVER_SYNC_KEYS.indexOf(key) === -1;
  }

  function isSyncOn(){
    return !!localStorage.getItem('lasync_server');
  }

  function genId(){
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getDeviceId(){
    var id = localStorage.getItem('lasync_device');
    if(!id){
      id = genId();
      localStorage.setItem('lasync_device', id);
    }
    return id;
  }

  function loadJson(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }

  function loadMeta(){ return loadJson('lasync_meta', {}); }
  function saveMeta(meta){ localStorage.setItem('lasync_meta', JSON.stringify(meta)); }
  function loadQueue(){ return loadJson('lasync_queue', []); }
  function saveQueue(queue){ localStorage.setItem('lasync_queue', JSON.stringify(queue)); }

  /* ---------- Catching writes ----------
     Push/pull land in Session 2; for now a queued key just sits
     in lasync_queue and the dot shows "queued" until that
     session's flush implementation replaces this stub. */
  function flushQueue(){
    /* Implemented in Session 2 (Push and pull). */
  }

  var flushTimer = null;
  function scheduleFlush(){
    if(flushTimer) return;
    flushTimer = setTimeout(function(){
      flushTimer = null;
      flushQueue();
      updateStatusUI();
    }, 1000);
  }

  function queueKey(key){
    var queue = loadQueue();
    if(queue.indexOf(key) === -1){
      queue.push(key);
      saveQueue(queue);
    }
    scheduleFlush();
    updateStatusUI();
  }

  function recordChange(key){
    var meta = loadMeta();
    var entry = meta[key] || {};
    entry.t = Date.now();
    meta[key] = entry;
    saveMeta(meta);
    queueKey(key);
  }

  var nativeSetItem = Storage.prototype.setItem;
  var nativeRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function(key, value){
    nativeSetItem.call(this, key, value);
    if(this === window.localStorage && isSyncOn() && isSyncableKey(key)){
      recordChange(key);
    }
  };

  Storage.prototype.removeItem = function(key){
    nativeRemoveItem.call(this, key);
    if(this === window.localStorage && isSyncOn() && isSyncableKey(key)){
      recordChange(key);
    }
  };

  /* ---------- Status dot ----------
     grey = off, amber = queued (push pending), green = connected
     and idle, red = last Connect attempt failed. */
  var STATUS_COLOR = { off:'#6b7280', queued:'#facc15', synced:'#4ade80', error:'#f87171' };
  var STATUS_LABEL = {
    off:'Sync: off', queued:'Sync: queued', synced:'Sync: synced', error:'Sync: error'
  };
  var lastConnectError = null;

  function computeStatus(){
    if(!isSyncOn()) return 'off';
    if(lastConnectError) return 'error';
    if(loadQueue().length > 0) return 'queued';
    return 'synced';
  }

  function updateStatusUI(){
    var status = computeStatus();
    var color = STATUS_COLOR[status];
    var label = STATUS_LABEL[status];
    document.querySelectorAll('.sync-status-dot').forEach(function(btn){
      var icon = btn.querySelector('.material-symbols-outlined');
      if(icon) icon.style.color = color;
      var tip = btn.querySelector('.sync-btn-tooltip');
      if(tip) tip.textContent = label;
      btn.title = label;
    });
  }

  /* ---------- Sync panel ---------- */
  function formatLastSync(){
    var raw = localStorage.getItem('lasync_last_sync');
    if(!raw) return 'Never';
    var ms = parseInt(raw, 10);
    return isNaN(ms) ? 'Never' : new Date(ms).toLocaleString();
  }

  function setPanelMessage(text, color){
    var msg = document.getElementById('sync-panel-message');
    if(!msg) return;
    msg.textContent = text || '';
    msg.style.color = color || 'var(--ink-dim)';
  }

  function renderPanelState(){
    var lastSyncLabel = document.getElementById('sync-last-sync-label');
    if(lastSyncLabel) lastSyncLabel.textContent = 'Last sync: ' + formatLastSync();
    if(lastConnectError){
      setPanelMessage(lastConnectError, '#fca5a5');
    } else if(isSyncOn()){
      setPanelMessage('Connected to ' + localStorage.getItem('lasync_server'), '#86efac');
    } else {
      setPanelMessage('Not connected.', 'var(--ink-dim)');
    }
  }

  function openSyncPanel(){
    var serverInput = document.getElementById('sync-server-input');
    var emailInput = document.getElementById('sync-email-input');
    if(serverInput) serverInput.value = localStorage.getItem('lasync_server') || '';
    if(emailInput) emailInput.value = localStorage.getItem('lasync_email') || '';
    renderPanelState();
    if(typeof window.openModal === 'function') window.openModal('sync-modal');
  }

  function handleConnectClick(){
    var serverInput = document.getElementById('sync-server-input');
    var emailInput = document.getElementById('sync-email-input');
    var passwordInput = document.getElementById('sync-password-input');
    var url = (serverInput.value || '').trim().replace(/\/+$/, '');
    var email = (emailInput.value || '').trim();
    var password = passwordInput.value || '';

    if(!url || !email || !password){
      setPanelMessage('Server URL, email and password are all required.', '#fca5a5');
      return;
    }
    if(typeof PocketBase === 'undefined'){
      setPanelMessage('Sync library failed to load.', '#fca5a5');
      return;
    }

    setPanelMessage('Connecting…', 'var(--ink-dim)');
    var pb = new PocketBase(url);
    pb.collection('users').authWithPassword(email, password).then(function(){
      localStorage.setItem('lasync_server', url);
      localStorage.setItem('lasync_email', email);
      passwordInput.value = '';
      lastConnectError = null;
      updateStatusUI();
      renderPanelState();
    }).catch(function(err){
      lastConnectError = 'Could not connect: ' + (err && err.message ? err.message : 'unknown error');
      updateStatusUI();
      renderPanelState();
    });
  }

  function handleDisconnectClick(){
    var url = localStorage.getItem('lasync_server');
    try{
      if(url && typeof PocketBase !== 'undefined'){
        new PocketBase(url).authStore.clear();
      }
    }catch(e){}
    localStorage.removeItem('lasync_server');
    lastConnectError = null;
    updateStatusUI();
    renderPanelState();
  }

  function buildSyncPanel(){
    if(document.getElementById('sync-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-overlay" id="sync-modal">' +
        '<div class="modal-card glass" style="width:340px;">' +
          '<div class="modal-header">' +
            '<span class="material-symbols-outlined">sync</span>' +
            '<h2>Sync</h2>' +
          '</div>' +
          '<div class="field-group">' +
            '<label class="field-label">Server URL</label>' +
            '<input class="field-text" type="text" id="sync-server-input" placeholder="https://desktop.tailnet.ts.net">' +
          '</div>' +
          '<div class="field-group">' +
            '<label class="field-label">Email</label>' +
            '<input class="field-text" type="email" id="sync-email-input" autocomplete="username">' +
          '</div>' +
          '<div class="field-group">' +
            '<label class="field-label">Password</label>' +
            '<input class="field-text" type="password" id="sync-password-input" autocomplete="current-password">' +
          '</div>' +
          '<p id="sync-panel-message" style="min-height:16px; font-size:0.72rem; margin:0 0 14px;"></p>' +
          '<div class="modal-close-row" style="justify-content:space-between; gap:8px;">' +
            '<button type="button" id="sync-connect-btn" style="flex:1; padding:8px 12px; border-radius:10px; border:1px solid rgba(74,222,128,0.4); background:rgba(74,222,128,0.14); color:#86efac; font-weight:700; cursor:pointer;">Connect</button>' +
            '<button type="button" id="sync-disconnect-btn" style="flex:1; padding:8px 12px; border-radius:10px; border:1px solid rgba(248,113,113,0.4); background:rgba(248,113,113,0.1); color:#fca5a5; font-weight:700; cursor:pointer;">Disconnect</button>' +
          '</div>' +
          '<p id="sync-last-sync-label" style="margin:12px 0 0; font-size:0.64rem; color:var(--ink-faint); text-align:center;">Last sync: Never</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);
    document.getElementById('sync-connect-btn').addEventListener('click', handleConnectClick);
    document.getElementById('sync-disconnect-btn').addEventListener('click', handleDisconnectClick);
  }

  function buildStatusDot(containerSelector, btnClass, withTooltip){
    var container = document.querySelector(containerSelector);
    if(!container) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = btnClass + ' sync-status-dot';
    btn.setAttribute('aria-label', 'Sync status');
    btn.addEventListener('click', openSyncPanel);
    btn.innerHTML = '<span class="material-symbols-outlined">sync</span>' +
      (withTooltip ? '<span class="sync-btn-tooltip">Sync: off</span>' : '');
    container.appendChild(btn);
  }

  function initUI(){
    buildSyncPanel();
    buildStatusDot('.sidebar-bottom-actions', 'sync-btn', true);
    buildStatusDot('.mobile-quick-actions', 'mobile-quick-btn', false);
    getDeviceId();
    updateStatusUI();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
