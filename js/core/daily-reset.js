/* ============================================================
   Daily reset / clock-tick cluster — shared by every page
   (index.html, financial-subpage.html, screens/*.html).
   performDailyReset (4 variants) and runClockTick (2 variants)
   differ per page, so this core provides the shared mechanics
   (checkDailyReset's once-per-day gate, the late-night tint,
   the sidebar clock) plus a hook each page registers its extra
   steps into, instead of duplicating the wrapper functions too.
   Depends on js/core.js (load that first).
============================================================ */
(function(){
  'use strict';

  function openModal(id){
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id){
    document.getElementById(id).classList.remove('open');
  }

  function addDaysISO(iso, delta){
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function getPreviousProductivityDate(){
    return addDaysISO(getAdjustedDate(), -1);
  }
  function formatDateHuman(iso){
    if(!iso) return '—';
    var d = new Date(iso + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  /* todayISO differs on purpose per page (index = 5AM-adjusted date,
     every other page = real midnight; see the comment in academic.js),
     so it stays two distinctly named functions here rather than one
     merged todayISO. */
  function todayISOAdjusted(){ return getAdjustedDate(); }
  function todayISOMidnight(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function updateLateNightMode(){
    document.body.classList.toggle('late-night', isLateNightWindow());
  }

  function clearTodayNutritionEntry(){
    /* Nutrition entries sync like any other la_ key, so clearing
       today's entry locally has nothing to do once sync is on —
       the night check-in's own write (or its absence) is the
       single source of truth everywhere. Guarded here, once, rather
       than at each of the 5 pages' registerDailyResetHook call
       sites. */
    if(typeof window.isSyncOn === 'function' && window.isSyncOn()) return;
    var cfg = loadJSON('la_nutrition', null);
    if(cfg && cfg.entries && cfg.entries[getAdjustedDate()] !== undefined){
      delete cfg.entries[getAdjustedDate()];
      saveJSON('la_nutrition', cfg);
    }
  }

  function isNightCheckinMissed(){
    var prevDate = getPreviousProductivityDate();
    if(localStorage.getItem('la_checkin_night_' + prevDate)) return false;
    if(localStorage.getItem('la_night_checkin_prompted_' + prevDate)) return false;
    return true;
  }

  function maybeRedirectForNightCheckin(){
    if(isNightCheckinMissed()){ window.location.href = '../index.html'; }
  }

  var _dailyResetHooks = [];
  function registerDailyResetHook(fn){ _dailyResetHooks.push(fn); }
  function performDailyReset(){
    _dailyResetHooks.forEach(function(fn){ fn(); });
  }

  function checkDailyReset(){
    /* js/core/sync.js (loaded before this file) exposes
       window.isSyncGateOpen() so the 5AM reset waits for this
       device's first pull instead of acting on stale pre-sync
       data. With sync off (or sync.js absent), the gate is always
       open and nothing here changes. */
    if(typeof window.isSyncGateOpen === 'function' && !window.isSyncGateOpen()) return;
    var adjusted = getAdjustedDate();
    /* Only the one device marked as running daily jobs (Sync panel
       checkbox; window.isDailyJobDevice()) writes the synced
       la_last_reset_date — a non-job device writing it too would
       make the job device see "already reset today" and skip its
       own jobs. A non-job device instead tracks its own once-per-
       day marker outside la_ (lasync_local_reset_date, never
       synced) so performDailyReset() still runs there once a day
       for the render-only refreshes; the data-writing jobs
       (js/financial.js's accrueSavings/checkPaycheckCycleReset/
       processRecurringDeductions) each check isDailyJobDevice()
       themselves and no-op on every other device regardless. */
    var isJobDevice = typeof window.isDailyJobDevice !== 'function' || window.isDailyJobDevice();
    var resetKey = isJobDevice ? 'la_last_reset_date' : 'lasync_local_reset_date';
    var last = localStorage.getItem(resetKey);
    if(last !== adjusted){
      performDailyReset();
      localStorage.setItem(resetKey, adjusted);
    }
  }

  /* index.html registers maybeAutoPromptNightCheckin instead; every
     other page uses this default (its own runClockTick called it
     directly before this extraction). */
  var _clockTickHook = maybeRedirectForNightCheckin;
  function registerClockTickHook(fn){ _clockTickHook = fn; }
  function runClockTick(){
    updateLateNightMode();
    checkDailyReset();
    _clockTickHook();
  }

  function updateSidebarDateTime(){
    var el = document.getElementById('sidebar-datetime');
    if(!el) return;
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var now = new Date();
    var hours = now.getHours();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12 || 12;
    var mins = now.getMinutes();
    var minStr = mins < 10 ? '0' + mins : '' + mins;
    el.textContent = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() +
      '  ·  ' + h12 + ':' + minStr + ' ' + ampm;
  }

  window.openModal = openModal;
  window.closeModal = closeModal;
  window.addDaysISO = addDaysISO;
  window.getPreviousProductivityDate = getPreviousProductivityDate;
  window.formatDateHuman = formatDateHuman;
  window.todayISOAdjusted = todayISOAdjusted;
  window.todayISOMidnight = todayISOMidnight;
  window.updateLateNightMode = updateLateNightMode;
  window.clearTodayNutritionEntry = clearTodayNutritionEntry;
  window.isNightCheckinMissed = isNightCheckinMissed;
  window.maybeRedirectForNightCheckin = maybeRedirectForNightCheckin;
  window.registerDailyResetHook = registerDailyResetHook;
  window.performDailyReset = performDailyReset;
  window.checkDailyReset = checkDailyReset;
  window.registerClockTickHook = registerClockTickHook;
  window.runClockTick = runClockTick;
  window.updateSidebarDateTime = updateSidebarDateTime;
})();
