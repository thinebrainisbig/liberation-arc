/* ============================================================
   js/core/sync.js — Step 3, Sessions 1-2 (Foundation; Push/Pull)

   Loaded FIRST on every page, before js/core.js and everything
   else, so the Storage.prototype wrap below is in place before
   any other script touches localStorage.

   Off by default: everything here is inert until lasync_server
   holds a server URL (set via Connect in the Sync panel). With
   it unset, every localStorage write behaves exactly as it did
   before this file existed.

   Session 1 built the foundation: the on/off switch, a device
   ID, the never-sync list, write capture into a queue, the
   status dot and the Sync panel's Connect/Disconnect flow.
   Session 2 adds push, pull, the first-sync rule and tombstones.
   Live updates (realtime subscribe), the redraw/refresh-pill
   wiring and the daily-job gate are Session 3 work.
============================================================ */
(function(){
  'use strict';

  /* ---------- Local bookkeeping keys (outside la_, so none of
     this ever syncs itself) ----------
     lasync_server   — server URL; sync is off when absent
     lasync_device   — random ID for this browser/app instance
     lasync_email    — last-used email, prefilled in the panel
     lasync_meta     — { [key]: { t: lastLocalChangeMs, id: kvRecordId } }
     lasync_queue    — array of la_ keys waiting to be pushed
     lasync_cursor   — server `updated` string of the last pull
     lasync_last_sync — ms timestamp of the last successful sync
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

  function removeFromQueue(key){
    var queue = loadQueue();
    var idx = queue.indexOf(key);
    if(idx !== -1){
      queue.splice(idx, 1);
      saveQueue(queue);
    }
  }

  var flushTimer = null;
  function scheduleFlush(){
    if(flushTimer) return;
    flushTimer = setTimeout(function(){
      flushTimer = null;
      flushQueue();
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

  /* ---------- PocketBase client ---------- */
  var pb = null;
  function getPB(){
    if(pb) return pb;
    if(typeof PocketBase === 'undefined') return null;
    var url = localStorage.getItem('lasync_server');
    if(!url) return null;
    pb = new PocketBase(url);
    return pb;
  }

  function describeError(err){
    if(!err) return 'unknown error';
    return err.message || String(err);
  }

  function markSynced(){
    localStorage.setItem('lasync_last_sync', String(Date.now()));
    lastSyncError = null;
    updateStatusUI();
    renderPanelState();
  }

  function markSyncError(err){
    lastSyncError = 'Sync error: ' + describeError(err);
    updateStatusUI();
    renderPanelState();
  }

  /* kv.value is always this device's localStorage string, wrapped
     in JSON.stringify — not an attempt to interpret the app's own
     JSON. This round-trips byte-for-byte regardless of whether the
     original localStorage text was itself JSON (saveJSON's output)
     or a bare string (e.g. la_last_reset_date's plain date text). */
  function toServerValue(rawString){ return JSON.stringify(rawString); }
  function fromServerValue(value){
    try{ return JSON.parse(value); }catch(e){ return null; }
  }

  /* Writes a server row into localStorage with the native,
     unwrapped Storage methods (so it's never re-queued), then
     records it in lasync_meta so this device agrees with the
     server for that key. Used by both pull and a push that loses
     a conflict. */
  function applyServerValue(key, record){
    if(record.deleted){
      nativeRemoveItem.call(localStorage, key);
    } else {
      nativeSetItem.call(localStorage, key, fromServerValue(record.value));
    }
    var meta = loadMeta();
    meta[key] = { t: record.clientUpdatedAt, id: record.id };
    saveMeta(meta);
  }

  /* Finds (or creates) this key's kv row and reconciles it with
     the local change. Leaves the key queued on any failure. */
  function pushKey(client, ownerId, key){
    var meta = loadMeta();
    var entry = meta[key] || {};
    var localT = entry.t || 0;
    var raw = localStorage.getItem(key);
    var deleted = raw === null;
    var body = {
      owner: ownerId,
      key: key,
      value: deleted ? null : toServerValue(raw),
      clientUpdatedAt: localT,
      deviceId: getDeviceId(),
      deleted: deleted
    };

    return client.collection('kv').getFirstListItem(client.filter('key = {:key}', { key: key }))
      .catch(function(err){
        if(err && err.status === 404) return null;
        throw err;
      })
      .then(function(existing){
        if(existing && existing.clientUpdatedAt > localT){
          applyServerValue(key, existing);
          return null;
        }
        if(existing){
          return client.collection('kv').update(existing.id, body);
        }
        return client.collection('kv').create(body);
      })
      .then(function(record){
        if(record){
          var meta2 = loadMeta();
          var e = meta2[key] || {};
          e.id = record.id;
          e.t = record.clientUpdatedAt;
          meta2[key] = e;
          saveMeta(meta2);
        }
        removeFromQueue(key);
      });
  }

  var pushing = false;
  function flushQueue(){
    if(pushing || !isSyncOn()) return;
    var client = getPB();
    if(!client || !client.authStore.isValid) return;
    var queue = loadQueue();
    if(!queue.length) return;
    var ownerId = client.authStore.record ? client.authStore.record.id : null;
    if(!ownerId) return;

    pushing = true;
    updateStatusUI();
    var chain = Promise.resolve();
    queue.forEach(function(key){
      chain = chain.then(function(){
        return pushKey(client, ownerId, key).catch(function(err){
          markSyncError(err);
        });
      });
    });
    chain.then(function(){
      pushing = false;
      if(!loadQueue().length) markSynced();
      updateStatusUI();
    });
  }

  /* Every syncable key already in localStorage before sync was
     ever turned on has no lasync_meta entry, so it counts as
     changed at time 0 (Part E, "First sync on a device"): pull
     lets the server's copy win for keys it already has, and
     queuing the rest here gets them pushed (created) below. Safe
     to call on every load — keys that already have meta are
     skipped, so it's a no-op once a device has fully synced once. */
  function seedQueueWithUnsyncedKeys(){
    var meta = loadMeta();
    var queue = loadQueue();
    var changed = false;
    for(var i = 0; i < localStorage.length; i++){
      var key = localStorage.key(i);
      if(isSyncableKey(key) && !meta[key] && queue.indexOf(key) === -1){
        queue.push(key);
        changed = true;
      }
    }
    if(changed) saveQueue(queue);
  }

  function pull(){
    if(!isSyncOn()) return Promise.resolve();
    var client = getPB();
    if(!client || !client.authStore.isValid) return Promise.resolve();

    var cursor = localStorage.getItem('lasync_cursor');
    var filterStr = cursor ? client.filter('updated >= {:cursor}', { cursor: cursor }) : '';
    return client.collection('kv').getFullList({ filter: filterStr, sort: 'updated', batch: 500 })
      .then(function(records){
        var newestUpdated = cursor || '';
        records.forEach(function(record){
          var meta = loadMeta();
          var localT = (meta[record.key] && meta[record.key].t) || 0;
          if(record.clientUpdatedAt > localT){
            applyServerValue(record.key, record);
          }
          if(record.updated > newestUpdated) newestUpdated = record.updated;
        });
        if(newestUpdated) localStorage.setItem('lasync_cursor', newestUpdated);
        markSynced();
      })
      .catch(function(err){
        markSyncError(err);
      });
  }

  /* "On load: pull, then push" (Part E). Also run right after a
     successful Connect, so a fresh sign-in starts syncing
     immediately instead of waiting for the next write. */
  function runLoadSequence(){
    pull().then(function(){
      seedQueueWithUnsyncedKeys();
      flushQueue();
    });
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
  var lastSyncError = null;

  function computeStatus(){
    if(!isSyncOn()) return 'off';
    if(lastSyncError) return 'error';
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
    if(lastSyncError){
      setPanelMessage(lastSyncError, '#fca5a5');
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
    var client = new PocketBase(url);
    client.collection('users').authWithPassword(email, password).then(function(){
      pb = client;
      localStorage.setItem('lasync_server', url);
      localStorage.setItem('lasync_email', email);
      passwordInput.value = '';
      lastSyncError = null;
      updateStatusUI();
      renderPanelState();
      runLoadSequence();
    }).catch(function(err){
      lastSyncError = 'Could not connect: ' + describeError(err);
      updateStatusUI();
      renderPanelState();
    });
  }

  function handleDisconnectClick(){
    try{
      var client = getPB();
      if(client) client.authStore.clear();
    }catch(e){}
    pb = null;
    localStorage.removeItem('lasync_server');
    lastSyncError = null;
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
    if(isSyncOn()) runLoadSequence();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
