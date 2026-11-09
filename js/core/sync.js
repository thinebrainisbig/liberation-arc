/* ============================================================
   js/core/sync.js — Step 3, Sessions 1-4

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
   Session 2 added push, pull, the first-sync rule and tombstones.
   Session 3 added the realtime subscription, the redraw/refresh-
   pill wiring, the pull triggers (visibility/pageshow/online/
   60s) and the daily-job gate (js/core/daily-reset.js checks
   window.isSyncGateOpen(), defined below).
   Session 4 adds: window.isDailyJobDevice()/the "runs daily jobs"
   checkbox, so only one device's js/financial.js writes the
   5AM-reset/paycheck/savings jobs; window.whenSyncReady() for
   page-load work that would otherwise race the first pull the
   same way the daily reset itself used to; conflict-hardening in
   pushKey (server/pb_migrations now rejects a stale update, and
   pushKey recovers from that plus a create-time unique-index
   race instead of erroring); and authRefresh() on every launch.
============================================================ */
(function(){
  'use strict';

  /* ---------- Local bookkeeping keys (outside la_, so none of
     this ever syncs itself) ----------
     lasync_server   — server URL; sync is off when absent
     lasync_device   — random ID for this browser/app instance
     lasync_email    — last-used email, prefilled in the panel
     lasync_jobs_device — '1' when this device runs the daily jobs
     lasync_meta     — { [key]: { t: lastLocalChangeMs, id: kvRecordId } }
     lasync_queue    — array of la_ keys waiting to be pushed
     lasync_cursor   — server `updated` string of the last pull
     lasync_last_sync — ms timestamp of the last successful sync
     lasync_local_reset_date — non-job device's own once-per-day
       marker for render-only refreshes (js/core/daily-reset.js);
       never written to la_last_reset_date, so a non-job device
       can't make the job device skip its own daily jobs
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
    pb = new PocketBase(url).autoCancellation(false);
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

  /* ---------- Daily jobs run on one device only (Step 3 Session 4) ----------
     'lasync_jobs_device' = '1' marks THIS device as the one that runs
     the data-writing daily jobs (5AM reset, paycheck cycle, recurring
     deductions, savings accrual) — set via the Sync panel checkbox.
     With sync off, every device is its own single-device world, same
     as before sync existed, so this always reads true then. */
  function isDailyJobDevice(){
    return !isSyncOn() || localStorage.getItem('lasync_jobs_device') === '1';
  }
  window.isDailyJobDevice = isDailyJobDevice;
  window.isSyncOn = isSyncOn;

  /* ---------- Daily-job gate ----------
     js/core/daily-reset.js's checkDailyReset calls
     window.isSyncGateOpen() and returns early while it's false, so
     the 5AM reset/accrual/paycheck jobs wait for this device's
     first pull instead of acting on stale pre-sync data. With sync
     off the gate starts (and stays) open, so nothing changes. */
  var dailyGateOpen = !isSyncOn();
  var syncReadyCallbacks = [];
  function openDailyGate(){
    if(dailyGateOpen) return;
    dailyGateOpen = true;
    /* whenSyncReady callbacks first, each isolated in its own
       try/catch, so neither a page's callback nor runClockTick
       throwing can stop the rest of this from running — this
       function is called from inside pull()'s own promise chain,
       where an uncaught throw here would otherwise surface as a
       confusing sync error instead of whatever actually failed. */
    var callbacks = syncReadyCallbacks;
    syncReadyCallbacks = [];
    callbacks.forEach(function(fn){
      try{ fn(); }catch(e){}
    });
    if(typeof window.runClockTick === 'function'){
      try{ window.runClockTick(); }catch(e){}
    }
  }
  window.isSyncGateOpen = function(){ return dailyGateOpen; };
  /* Runs fn now if the gate is already open, otherwise queues it to
     run once it opens. For page-load work (e.g. financial.js's
     accrueSavings()) that would otherwise race the first pull the
     same way the daily reset itself used to. */
  window.whenSyncReady = function(fn){
    if(dailyGateOpen) fn();
    else syncReadyCallbacks.push(fn);
  };
  /* 10s, not 3s: autoCancellation is off (see getPB/handleConnectClick)
     so a slow pull from the phone can't be cancelled out from under
     itself and open the gate early — this is purely a last-resort
     backstop for e.g. an offline device, which still resets after
     10s rather than waiting forever. */
  if(!dailyGateOpen) setTimeout(openDailyGate, 10000);

  /* ---------- Redraw / refresh pill ---------- */
  var pillEl = null;
  function showRefreshPill(){
    if(!pillEl){
      pillEl = document.createElement('div');
      pillEl.id = 'sync-refresh-pill';
      pillEl.setAttribute('role', 'button');
      pillEl.style.cssText = 'position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:200;' +
        ' display:flex; align-items:center; gap:8px; padding:9px 16px; border-radius:999px;' +
        ' background:rgba(10,10,14,0.92); border:1px solid rgba(255,255,255,0.14); color:#e5e7eb;' +
        ' font-size:0.78rem; font-weight:600; cursor:pointer; backdrop-filter:blur(6px);' +
        ' -webkit-backdrop-filter:blur(6px); box-shadow:0 8px 24px rgba(0,0,0,0.35);';
      pillEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">refresh</span>' +
        '<span>New data — tap to refresh</span>';
      pillEl.addEventListener('click', function(){ location.reload(); });
      document.body.appendChild(pillEl);
    }
    pillEl.style.display = 'flex';
  }

  /* Redraw after applying a key from either pull or a live event.
     window.handleStorageSync exists on every page today, so the
     pill is really just a fallback for a page that somehow doesn't
     define one — handleStorageSync itself already only reacts to
     the keys it cares about and ignores the rest. */
  function notifyPageOfChange(key){
    if(typeof window.handleStorageSync === 'function'){
      window.handleStorageSync({ key: key });
    } else {
      showRefreshPill();
    }
  }

  /* kv.value is always this device's localStorage string, wrapped
     in JSON.stringify so an arbitrary string round-trips as one
     opaque JSON string value — not an attempt to interpret the
     app's own JSON. PocketBase (and the SDK) decode that JSON value
     exactly once on the way in and back out, so what comes back as
     record.value is already the original raw string itself; parsing
     it again here would turn a JSON-array/object string into an
     actual array/object (and then localStorage.setItem would
     stringify THAT as "[object Object]" instead of the original
     text). Only fall back to re-stringifying for an unexpected
     non-string value (e.g. a hand-edited row). */
  function toServerValue(rawString){ return JSON.stringify(rawString); }
  function fromServerValue(value){
    if(typeof value === 'string') return value;
    return value === null || value === undefined ? null : JSON.stringify(value);
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

  /* Given a row that already exists for this key, either adopt it
     (it's newer than our local change) or update it with our body.
     The kv updateRule (server/pb_migrations) rejects an update whose
     clientUpdatedAt isn't strictly newer than the stored row's, which
     surfaces as a 404 (same as the row not matching the access rule
     at all) — that means another device won a race since we looked
     this row up, so re-fetch it and adopt its copy instead of
     erroring. */
  function reconcileWithExisting(client, key, body, localT, existing){
    if(existing.clientUpdatedAt > localT){
      applyServerValue(key, existing);
      return Promise.resolve(null);
    }
    return client.collection('kv').update(existing.id, body)
      .catch(function(err){
        if(err && err.status === 404){
          return client.collection('kv').getFirstListItem(client.filter('key = {:key}', { key: key }))
            .then(function(latest){
              if(latest) applyServerValue(key, latest);
              return null;
            });
        }
        throw err;
      });
  }

  /* Finds (or creates) this key's kv row and reconciles it with
     the local change. Leaves the key queued on any failure. */
  function pushKey(client, ownerId, key){
    var meta = loadMeta();
    var entry = meta[key] || {};
    var localT = entry.t || 0;
    /* clientUpdatedAt is a required number field, and PocketBase
       treats 0 as that field's empty value and rejects it. A key
       with no lasync_meta entry yet (localT === 0, the first-sync
       sentinel) still needs a real timestamp to send, so fall back
       to now — localT itself stays 0 for the "is the server newer
       than what we've seen" comparison below. */
    var sendT = localT || Date.now();
    var raw = localStorage.getItem(key);
    var deleted = raw === null;
    var body = {
      owner: ownerId,
      key: key,
      value: deleted ? null : toServerValue(raw),
      clientUpdatedAt: sendT,
      deviceId: getDeviceId(),
      deleted: deleted
    };

    return client.collection('kv').getFirstListItem(client.filter('key = {:key}', { key: key }))
      .catch(function(err){
        if(err && err.status === 404) return null;
        throw err;
      })
      .then(function(existing){
        if(existing) return reconcileWithExisting(client, key, body, localT, existing);
        return client.collection('kv').create(body)
          .catch(function(err){
            /* Two devices creating the same new key at once: the
               unique (owner, key) index rejects the second create.
               Re-run the lookup and fall into the normal
               update-or-apply path instead of waiting for the next
               60s trigger to sort it out. */
            if(err && err.status === 400){
              return client.collection('kv').getFirstListItem(client.filter('key = {:key}', { key: key }))
                .then(function(existing2){
                  if(existing2) return reconcileWithExisting(client, key, body, localT, existing2);
                  throw err;
                });
            }
            throw err;
          });
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
    if(!isSyncOn()){ openDailyGate(); return Promise.resolve(); }
    var client = getPB();
    if(!client || !client.authStore.isValid){ openDailyGate(); return Promise.resolve(); }

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
            notifyPageOfChange(record.key);
          }
          if(record.updated > newestUpdated) newestUpdated = record.updated;
        });
        if(newestUpdated) localStorage.setItem('lasync_cursor', newestUpdated);
        markSynced();
        /* Only opened here, on an actual successful pull — not in
           .catch below. A cancelled request (two overlapping pulls;
           see runLoadSequence's non-reentrancy guard) rejects just
           like a real failure, and opening the gate on that would
           let a stale-data daily reset win a race against the real
           pull's result. An offline/failing device instead falls
           back to the 10s timer above. */
        openDailyGate();
      })
      .catch(function(err){
        markSyncError(err);
      });
  }

  /* Live updates while this device's tab/app is open: the same
     apply logic as pull, fed by the server's realtime feed instead
     of a fetch. Echoes of this device's own pushes (same deviceId)
     are ignored — they're already reflected locally. */
  function handleRealtimeEvent(e){
    var record = e && e.record;
    if(!record || !record.key) return;
    if(record.deviceId === getDeviceId()) return;
    var meta = loadMeta();
    var localT = (meta[record.key] && meta[record.key].t) || 0;
    if(record.clientUpdatedAt > localT){
      applyServerValue(record.key, record);
      notifyPageOfChange(record.key);
    }
  }

  var realtimeStarted = false;
  function startRealtime(client){
    if(realtimeStarted || !client || !client.authStore.isValid) return;
    realtimeStarted = true;
    client.collection('kv').subscribe('*', handleRealtimeEvent).catch(function(){ realtimeStarted = false; });
    /* PB_CONNECT fires on every (re)connect of the realtime SSE
       stream, including after a dropped connection comes back —
       run the load sequence then to catch anything missed while
       disconnected (the SDK reconnects on its own; this just
       catches us up once it does). */
    client.realtime.subscribe('PB_CONNECT', runLoadSequence).catch(function(){});
  }
  function stopRealtime(client){
    realtimeStarted = false;
    try{ if(client) client.realtime.unsubscribe(); }catch(e){}
  }

  /* "On load: pull, then push" (Part E). Also run right after a
     successful Connect, so a fresh sign-in starts syncing
     immediately instead of waiting for the next write. Safe to
     call unconditionally (e.g. from the pull triggers below) —
     it's a no-op whenever sync is off.

     Non-reentrant: initUI and the pageshow trigger (among others)
     can both fire at load, which used to start two overlapping
     pulls — the PocketBase SDK cancels the first as a duplicate
     GET, and that cancellation was being treated as "the pull
     finished" by the daily-job gate. A call that arrives while one
     is already running just marks a pending flag instead of
     starting a second one in parallel; once the in-flight call
     finishes, it runs again exactly once to pick up anything that
     prompted the second call. */
  var loadSequenceRunning = false;
  var loadSequencePending = false;
  function runLoadSequence(){
    if(!isSyncOn()) return;
    if(loadSequenceRunning){
      loadSequencePending = true;
      return;
    }
    loadSequenceRunning = true;
    pull().then(function(){
      seedQueueWithUnsyncedKeys();
      flushQueue();
    }).then(function(){
      loadSequenceRunning = false;
      if(loadSequencePending){
        loadSequencePending = false;
        runLoadSequence();
      }
    });
  }

  /* Pull triggers (Part E): on return to the foreground and every
     60s while visible, so edits made elsewhere (or made here while
     offline) show up without a reload. iOS freezes the Home Screen
     app in the background, so these foreground-triggered pulls
     matter most on the phone. */
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') runLoadSequence();
  });
  window.addEventListener('pageshow', runLoadSequence);
  window.addEventListener('online', runLoadSequence);
  setInterval(function(){
    if(document.visibilityState === 'visible') runLoadSequence();
  }, 60000);

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
    var jobsCheckbox = document.getElementById('sync-jobs-device-checkbox');
    if(serverInput) serverInput.value = localStorage.getItem('lasync_server') || '';
    if(emailInput) emailInput.value = localStorage.getItem('lasync_email') || '';
    if(jobsCheckbox) jobsCheckbox.checked = localStorage.getItem('lasync_jobs_device') === '1';
    renderPanelState();
    if(typeof window.openModal === 'function') window.openModal('sync-modal');
  }

  function handleJobsDeviceChange(e){
    if(e.target.checked){
      localStorage.setItem('lasync_jobs_device', '1');
    } else {
      localStorage.removeItem('lasync_jobs_device');
    }
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
    var client = new PocketBase(url).autoCancellation(false);
    client.collection('users').authWithPassword(email, password).then(function(){
      pb = client;
      localStorage.setItem('lasync_server', url);
      localStorage.setItem('lasync_email', email);
      passwordInput.value = '';
      lastSyncError = null;
      updateStatusUI();
      renderPanelState();
      startRealtime(client);
      runLoadSequence();
    }).catch(function(err){
      lastSyncError = 'Could not connect: ' + describeError(err);
      updateStatusUI();
      renderPanelState();
    });
  }

  function handleDisconnectClick(){
    var client = getPB();
    stopRealtime(client);
    try{
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
          '<div class="modal-header" style="justify-content:space-between;">' +
            '<div style="display:flex; align-items:center; gap:10px;">' +
              '<span class="material-symbols-outlined">sync</span>' +
              '<h2>Sync</h2>' +
            '</div>' +
            '<button type="button" id="sync-modal-close-btn" aria-label="Close" title="Close" style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); color:var(--ink-dim); cursor:pointer; flex-shrink:0;">' +
              '<span class="material-symbols-outlined" style="font-size:18px;">close</span>' +
            '</button>' +
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
          '<label style="display:flex; align-items:flex-start; gap:8px; margin:0 0 14px; font-size:0.7rem; color:var(--ink-dim); cursor:pointer;">' +
            '<input type="checkbox" id="sync-jobs-device-checkbox" style="margin-top:2px; flex-shrink:0;">' +
            '<span>This device runs daily jobs (5 AM reset, paycheck, recurring deductions, savings interest)</span>' +
          '</label>' +
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
    document.getElementById('sync-jobs-device-checkbox').addEventListener('change', handleJobsDeviceChange);
    document.getElementById('sync-modal-close-btn').addEventListener('click', function(){
      if(typeof window.closeModal === 'function') window.closeModal('sync-modal');
    });
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
    if(isSyncOn()){
      var client = getPB();
      if(client){
        /* authRefresh() on every launch: confirms the stored token
           is still accepted and renews its 30-day expiry. On
           failure (expired, revoked, or never actually signed in),
           mark the error (dot turns red) and reopen the Sync panel
           so the password can be re-entered, instead of silently
           sitting on a dead session until the first pull/push also
           fails later. */
        client.collection('users').authRefresh().then(function(){
          startRealtime(client);
          runLoadSequence();
        }).catch(function(err){
          lastSyncError = 'Sign-in expired: ' + describeError(err);
          updateStatusUI();
          openSyncPanel();
        });
      }
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
