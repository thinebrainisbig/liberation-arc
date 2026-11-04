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

  function updateLateNightMode(){
    document.body.classList.toggle('late-night', isLateNightWindow());
  }

  function clearTodayNutritionEntry(){
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
    var adjusted = getAdjustedDate();
    var last = localStorage.getItem('la_last_reset_date');
    if(last !== adjusted){
      performDailyReset();
      localStorage.setItem('la_last_reset_date', adjusted);
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
