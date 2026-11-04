/* ============================================================
   Physical subpage — extracted from physical-subpage.html's
   inline <script> block (Phase B reorg). Page-specific logic
   only; depends on js/core.js, js/weather-widget.js,
   js/spotify-widget.js, js/youtube-widget.js (load those first).
============================================================ */
  function openModal(id){
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id){
    document.getElementById(id).classList.remove('open');
  }
  document.querySelectorAll('.modal-overlay').forEach(function(overlay){
    overlay.addEventListener('click', function(e){
      if(e.target === overlay){
        overlay.classList.remove('open');
      }
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay.open').forEach(function(o){ o.classList.remove('open'); });
    }
  });

  /* ============================================================
     Apple Health Import (export.xml, chunk-streamed, string-matched)
  ============================================================ */
  var HEALTH_TYPE_LABELS = {
    HKQuantityTypeIdentifierStepCount: 'steps',
    HKCategoryTypeIdentifierSleepAnalysis: 'sleep records',
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'HRV',
    HKQuantityTypeIdentifierRestingHeartRate: 'resting heart rate',
    HKQuantityTypeIdentifierBodyMass: 'weight',
    HKQuantityTypeIdentifierVO2Max: 'VO2 max',
    HKQuantityTypeIdentifierActiveEnergyBurned: 'active energy',
    Workout: 'workouts'
  };
  var HEALTH_SUMMARY_META = [
    { key:'la_health_steps', label:'Steps', unit:'days' },
    { key:'la_health_sleep', label:'Sleep', unit:'nights' },
    { key:'la_health_hrv', label:'HRV', unit:'days' },
    { key:'la_health_rhr', label:'Resting Heart Rate', unit:'days' },
    { key:'la_health_weight', label:'Weight', unit:'entries' },
    { key:'la_health_vo2', label:'VO2 Max', unit:'entries' },
    { key:'la_health_calories', label:'Active Calories', unit:'days' },
    { key:'la_health_workouts', label:'Workouts', unit:'workouts' }
  ];
  var HEALTH_CHUNK_SIZE = 10 * 1024 * 1024;
  var HEALTH_TAG_RE = /<(Record|Workout)\b([^>]*)>/g;
  var healthImportState = null;

  function openImportModal(){
    resetImportModal();
    openModal('import-modal');
  }
  function closeImportModal(){
    closeModal('import-modal');
    if(typeof renderHealthCards === 'function') renderHealthCards();
  }
  function resetImportModal(){
    healthImportState = null;
    document.getElementById('import-dropzone').style.display = 'flex';
    document.getElementById('import-progress-section').style.display = 'none';
    document.getElementById('import-summary-section').style.display = 'none';
    document.getElementById('import-progress-fill').style.width = '0%';
    document.getElementById('import-status-text').textContent = 'Reading file...';
    document.getElementById('import-file-input').value = '';
  }

  (function initImportDropzone(){
    var dropzone = document.getElementById('import-dropzone');
    var fileInput = document.getElementById('import-file-input');
    if(!dropzone || !fileInput) return;
    fileInput.addEventListener('change', function(){
      if(fileInput.files && fileInput.files[0]) startHealthImport(fileInput.files[0]);
    });
    ['dragenter','dragover'].forEach(function(evt){
      dropzone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave','drop'].forEach(function(evt){
      dropzone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function(e){
      var files = e.dataTransfer && e.dataTransfer.files;
      if(files && files[0]) startHealthImport(files[0]);
    });
  })();

  function formatHealthBytes(bytes){
    if(bytes > 1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
    if(bytes > 1024) return (bytes/1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function startHealthImport(file){
    document.getElementById('import-dropzone').style.display = 'none';
    document.getElementById('import-progress-section').style.display = 'block';
    document.getElementById('import-filename').textContent = file.name + ' · ' + formatHealthBytes(file.size);

    healthImportState = {
      offset: 0,
      buffer: '',
      fileSize: file.size,
      lastLabel: '',
      steps: {}, calories: {}, hrv: {}, rhr: {}, weight: {}, vo2: {},
      sleep: {}, workouts: []
    };
    readHealthChunk(file);
  }

  function readHealthChunk(file){
    var st = healthImportState;
    if(!st) return;
    if(st.offset >= st.fileSize){ finishHealthImport(); return; }
    var slice = file.slice(st.offset, st.offset + HEALTH_CHUNK_SIZE);
    var reader = new FileReader();
    reader.onload = function(e){
      st.offset += slice.size;
      st.buffer += e.target.result;
      processHealthBuffer();
      var pct = Math.min(100, Math.round((st.offset / st.fileSize) * 100));
      var fill = document.getElementById('import-progress-fill');
      if(fill) fill.style.width = pct + '%';
      setTimeout(function(){ readHealthChunk(file); }, 0);
    };
    reader.readAsText(slice);
  }

  function processHealthBuffer(){
    var st = healthImportState;
    HEALTH_TAG_RE.lastIndex = 0;
    var match, lastEnd = 0;
    while((match = HEALTH_TAG_RE.exec(st.buffer)) !== null){
      var tagName = match[1];
      var attrStr = match[2];
      if(attrStr.charAt(attrStr.length - 1) === '/') attrStr = attrStr.slice(0, -1);
      var attrs = parseHealthAttrs(attrStr);
      if(tagName === 'Record') handleHealthRecord(attrs);
      else handleHealthWorkout(attrs);
      lastEnd = HEALTH_TAG_RE.lastIndex;
    }
    st.buffer = st.buffer.slice(lastEnd);
  }

  function parseHealthAttrs(str){
    var attrs = {};
    var re = /(\w+)="([^"]*)"/g;
    var m;
    while((m = re.exec(str)) !== null){ attrs[m[1]] = m[2]; }
    return attrs;
  }

  function healthDateStr(s){ return s ? s.slice(0,10) : ''; }
  function healthHour(s){ return s ? parseInt(s.slice(11,13), 10) : 0; }
  function healthAddDays(dateStr, n){
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0,10);
  }

  function setHealthStatus(type){
    var st = healthImportState;
    var label = HEALTH_TYPE_LABELS[type];
    if(!label || label === st.lastLabel) return;
    st.lastLabel = label;
    var el = document.getElementById('import-status-text');
    if(el) el.textContent = 'Parsing ' + label + '...';
  }

  function handleHealthRecord(attrs){
    var st = healthImportState;
    var type = attrs.type;
    if(!type || !attrs.startDate) return;
    var date = healthDateStr(attrs.startDate);
    var value = parseFloat(attrs.value);

    if(type === 'HKQuantityTypeIdentifierStepCount'){
      setHealthStatus(type);
      if(!isNaN(value)) st.steps[date] = (st.steps[date] || 0) + value;
    } else if(type === 'HKQuantityTypeIdentifierActiveEnergyBurned'){
      setHealthStatus(type);
      if(!isNaN(value)) st.calories[date] = (st.calories[date] || 0) + value;
    } else if(type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'){
      setHealthStatus(type);
      if(!isNaN(value)){
        var h = st.hrv[date] || { sum:0, count:0 };
        h.sum += value; h.count++;
        st.hrv[date] = h;
      }
    } else if(type === 'HKQuantityTypeIdentifierRestingHeartRate'){
      setHealthStatus(type);
      if(!isNaN(value)) st.rhr[date] = value;
    } else if(type === 'HKQuantityTypeIdentifierBodyMass'){
      setHealthStatus(type);
      if(!isNaN(value)){
        var unit = attrs.unit || 'lb';
        var lb = unit.toLowerCase().indexOf('kg') !== -1 ? value * 2.20462 : value;
        st.weight[date] = lb;
      }
    } else if(type === 'HKQuantityTypeIdentifierVO2Max'){
      setHealthStatus(type);
      if(!isNaN(value)) st.vo2[date] = value;
    } else if(type === 'HKCategoryTypeIdentifierSleepAnalysis'){
      setHealthStatus(type);
      handleHealthSleep(attrs);
    }
  }

  function handleHealthSleep(attrs){
    var st = healthImportState;
    if(!attrs.startDate || !attrs.endDate) return;
    var startDate = attrs.startDate, endDate = attrs.endDate;
    var minutes = (new Date(endDate) - new Date(startDate)) / 60000;
    if(!isFinite(minutes) || minutes <= 0) return;
    var night = healthHour(startDate) >= 18 ? healthAddDays(healthDateStr(startDate), 1) : healthDateStr(startDate);
    var bucket = st.sleep[night] || { deep:0, rem:0, core:0, awake:0 };
    var value = attrs.value || '';
    if(value.indexOf('Deep') !== -1) bucket.deep += minutes;
    else if(value.indexOf('REM') !== -1) bucket.rem += minutes;
    else if(value.indexOf('Awake') !== -1) bucket.awake += minutes;
    else if(value.indexOf('Core') !== -1 || value.indexOf('Asleep') !== -1) bucket.core += minutes;
    st.sleep[night] = bucket;
  }

  function handleHealthWorkout(attrs){
    var st = healthImportState;
    if(!attrs.startDate) return;
    setHealthStatus('Workout');
    var type = (attrs.workoutActivityType || 'Workout').replace(/^HKWorkoutActivityType/, '').replace(/([A-Z])/g, ' $1').trim();
    var distance = parseFloat(attrs.totalDistance);
    var calories = parseFloat(attrs.totalEnergyBurned);
    var duration = parseFloat(attrs.duration);
    st.workouts.push({
      date: healthDateStr(attrs.startDate),
      type: type || 'Workout',
      duration: isNaN(duration) ? 0 : duration,
      calories: isNaN(calories) ? 0 : calories,
      distance: isNaN(distance) ? 0 : distance
    });
  }

  function finishHealthImport(){
    var st = healthImportState;
    if(!st) return;

    var stepsArr = Object.keys(st.steps).sort().map(function(d){ return { date:d, steps:Math.round(st.steps[d]) }; });
    var caloriesArr = Object.keys(st.calories).sort().map(function(d){ return { date:d, calories:Math.round(st.calories[d]) }; });
    var hrvArr = Object.keys(st.hrv).sort().map(function(d){ var h = st.hrv[d]; return { date:d, value: Math.round((h.sum / h.count) * 10) / 10 }; });
    var rhrArr = Object.keys(st.rhr).sort().map(function(d){ return { date:d, value: Math.round(st.rhr[d]) }; });
    var weightArr = Object.keys(st.weight).sort().map(function(d){ return { date:d, value: Math.round(st.weight[d] * 10) / 10, unit:'lb' }; });
    var vo2Arr = Object.keys(st.vo2).sort().map(function(d){ return { date:d, value: Math.round(st.vo2[d] * 10) / 10 }; });
    var sleepArr = Object.keys(st.sleep).sort().map(function(d){
      var b = st.sleep[d];
      return {
        date:d,
        totalMinutes: Math.round(b.deep + b.rem + b.core),
        deep: Math.round(b.deep), rem: Math.round(b.rem), core: Math.round(b.core), awake: Math.round(b.awake)
      };
    });
    var workoutsArr = st.workouts.slice().sort(function(a,b){ return a.date < b.date ? 1 : -1; });

    localStorage.setItem('la_health_steps', JSON.stringify(stepsArr));
    localStorage.setItem('la_health_sleep', JSON.stringify(sleepArr));
    localStorage.setItem('la_health_hrv', JSON.stringify(hrvArr));
    localStorage.setItem('la_health_rhr', JSON.stringify(rhrArr));
    localStorage.setItem('la_health_weight', JSON.stringify(weightArr));
    localStorage.setItem('la_health_vo2', JSON.stringify(vo2Arr));
    localStorage.setItem('la_health_calories', JSON.stringify(caloriesArr));
    localStorage.setItem('la_health_workouts', JSON.stringify(workoutsArr));

    showHealthImportSummary({
      la_health_steps: stepsArr.length,
      la_health_sleep: sleepArr.length,
      la_health_hrv: hrvArr.length,
      la_health_rhr: rhrArr.length,
      la_health_weight: weightArr.length,
      la_health_vo2: vo2Arr.length,
      la_health_calories: caloriesArr.length,
      la_health_workouts: workoutsArr.length
    });
    healthImportState = null;
  }

  function showHealthImportSummary(counts){
    document.getElementById('import-progress-section').style.display = 'none';
    var list = document.getElementById('import-summary-list');
    list.innerHTML = '';
    HEALTH_SUMMARY_META.forEach(function(meta){
      var row = document.createElement('div');
      row.className = 'import-summary-row';
      row.innerHTML = '<span class="name"><span class="material-symbols-outlined">check_circle</span>' + meta.label + '</span>' +
        '<span class="count mono">' + (counts[meta.key] || 0) + ' ' + meta.unit + '</span>';
      list.appendChild(row);
    });
    document.getElementById('import-summary-section').style.display = 'block';
  }

  /* ============================================================
     Storage helpers
     (loadJSON/saveJSON/uid/escapeHtml/escapeAttr/syncData/
     triggerImportData/handleImportFileSelected/isLateNightWindow/
     getAdjustedDate/notifyStateChange now live in js/core.js)
  ============================================================ */

  function todayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function isoFromDate(d){
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  /* ============================================================
     Gym Split — weekly planner (la_gym_split) + read-only
     monthly calendar, both driven by night check-in workoutDone
  ============================================================ */
  var SPLIT_DAY_META = [
    { dow:1, label:'MON', color:'#93c5fd', bg:'rgba(96,165,250,0.16)' },
    { dow:2, label:'TUE', color:'#fda4af', bg:'rgba(251,113,133,0.16)' },
    { dow:3, label:'WED', color:'#86efac', bg:'rgba(74,222,128,0.16)' },
    { dow:4, label:'THU', color:'#fcd34d', bg:'rgba(250,204,21,0.16)' },
    { dow:5, label:'FRI', color:'#fdba74', bg:'rgba(251,146,60,0.16)' },
    { dow:6, label:'SAT', color:'#67e8f9', bg:'rgba(34,211,238,0.16)' },
    { dow:0, label:'SUN', color:'#d8b4fe', bg:'rgba(192,132,252,0.16)' }
  ];
  var DEFAULT_GYM_SPLIT = {
    1: { name:'Chest & Triceps', notes:'45 min · High Volume', isRest:false },
    2: { name:'', notes:'', isRest:false },
    3: { name:'Back & Biceps', notes:'50 min · Progressive', isRest:false },
    4: { name:'', notes:'', isRest:false },
    5: { name:'Legs & Core', notes:'60 min · Strength', isRest:false },
    6: { name:'', notes:'', isRest:false },
    0: { name:'Active Recovery', notes:'Yoga / Swim', isRest:false }
  };

  function getGymSplit(){
    var data = loadJSON('la_gym_split', null);
    if(!data){ data = JSON.parse(JSON.stringify(DEFAULT_GYM_SPLIT)); saveJSON('la_gym_split', data); }
    SPLIT_DAY_META.forEach(function(m){ if(!data[m.dow]) data[m.dow] = { name:'', notes:'', isRest:false }; });
    return data;
  }
  function saveGymSplit(data){ saveJSON('la_gym_split', data); }

  function mostRecentDateForDow(dow){
    var d = new Date(getAdjustedDate() + 'T00:00:00');
    var diff = (d.getDay() - dow + 7) % 7;
    d.setDate(d.getDate() - diff);
    return isoFromDate(d);
  }

  function computeSplitDotStatus(dow, row){
    if(row.isRest) return 'grey';
    var checkin = loadJSON('la_checkin_night_' + mostRecentDateForDow(dow), null);
    if(!checkin || !checkin.workoutDone) return 'grey';
    if(checkin.workoutDone === 'Yes') return 'green';
    if(checkin.workoutDone === 'Rest') return 'grey';
    return 'red';
  }
  function splitStatusTitle(status){
    if(status === 'green') return 'Completed';
    if(status === 'red') return 'Not completed';
    return 'Rest day / no check-in yet';
  }

  function renderSplitPlanner(){
    var data = getGymSplit();
    var wrap = document.getElementById('split-planner');
    wrap.innerHTML = SPLIT_DAY_META.map(function(m){
      var row = data[m.dow];
      var status = computeSplitDotStatus(m.dow, row);
      return '<div class="split-row' + (row.isRest ? ' rest' : '') + '" data-dow="' + m.dow + '">' +
        '<div class="split-row-day" style="background:' + m.bg + '; color:' + m.color + ';">' + m.label + '</div>' +
        '<div class="split-row-fields">' +
          '<input type="text" class="split-name-input" placeholder="Workout name" value="' + escapeHtml(row.name) + '" oninput="updateSplitField(' + m.dow + ',\'name\',this.value)">' +
          '<input type="text" class="split-notes-input" placeholder="Notes (e.g. 45 min · High Volume)" value="' + escapeHtml(row.notes) + '" oninput="updateSplitField(' + m.dow + ',\'notes\',this.value)">' +
        '</div>' +
        '<div class="split-row-actions">' +
          '<button type="button" class="split-rest-toggle' + (row.isRest ? ' active' : '') + '" onclick="toggleSplitRest(' + m.dow + ')">Rest Day</button>' +
          '<div class="split-status-dot ' + status + '" title="' + splitStatusTitle(status) + '"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function updateSplitField(dow, field, value){
    var data = getGymSplit();
    data[dow][field] = value;
    saveGymSplit(data);
  }

  function toggleSplitRest(dow){
    var data = getGymSplit();
    data[dow].isRest = !data[dow].isRest;
    saveGymSplit(data);
    renderSplitPlanner();
    renderSplitCalendar();
  }

  var splitCalViewYear = new Date().getFullYear();
  var splitCalViewMonth = new Date().getMonth();

  function shiftSplitCalMonth(delta){
    splitCalViewMonth += delta;
    if(splitCalViewMonth < 0){ splitCalViewMonth = 11; splitCalViewYear--; }
    else if(splitCalViewMonth > 11){ splitCalViewMonth = 0; splitCalViewYear++; }
    renderSplitCalendar();
  }

  var SPLIT_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function renderSplitCalendar(){
    document.getElementById('split-cal-title').textContent = SPLIT_MONTH_NAMES[splitCalViewMonth] + ' ' + splitCalViewYear;

    var data = getGymSplit();
    var firstOfMonth = new Date(splitCalViewYear, splitCalViewMonth, 1);
    var leadBlank = firstOfMonth.getDay();
    var daysInMonth = new Date(splitCalViewYear, splitCalViewMonth + 1, 0).getDate();
    var todayIso = getAdjustedDate();

    var html = '';
    for(var i = 0; i < leadBlank; i++){
      html += '<div class="split-cal-cell empty-cell"></div>';
    }
    for(var day = 1; day <= daysInMonth; day++){
      var d = new Date(splitCalViewYear, splitCalViewMonth, day);
      var iso = isoFromDate(d);
      var dow = d.getDay();
      var checkin = loadJSON('la_checkin_night_' + iso, null);
      var status = 'neutral';
      if(checkin && checkin.workoutDone === 'Yes') status = 'green';
      else if(checkin && checkin.workoutDone === 'No') status = 'red';
      else if(checkin && checkin.workoutDone === 'Rest') status = 'grey';
      else if(data[dow] && data[dow].isRest) status = 'grey';
      var statusClass = status === 'neutral' ? '' : ' status-' + status;
      var todayClass = iso === todayIso ? ' today' : '';
      html += '<div class="split-cal-cell' + statusClass + todayClass + '">' + day + '</div>';
    }
    document.getElementById('split-cal-grid').innerHTML = html;
  }

  function formatDateHuman(iso){
    if(!iso) return '—';
    var d = new Date(iso + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function addDaysISO(iso, delta){
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function getPreviousProductivityDate(){
    return addDaysISO(getAdjustedDate(), -1);
  }
  /* isNightCheckinMissed/maybeRedirectForNightCheckin now live in
     js/core/daily-reset.js. */
  /* ============================================================
     Cross-page live sync. handleStorageSync is the single source of
     truth for "what to re-render when key X changes" — it's wired to
     the native `storage` event (fires in OTHER tabs only, never the
     tab that made the change) AND to a local `state-change` CustomEvent
     dispatched by notifyStateChange(), so same-tab mutations (e.g. the
     Morning/Night modal save) get the identical re-render treatment
     instantly, without waiting for a refresh.
  ============================================================ */
  function handleStorageSync(e){
    if(e.key && e.key.indexOf('la_health_') === 0){
      renderHealthCards();
    }
    else if(e.key && e.key.indexOf('la_checkin_') === 0){
      renderMonthlyTrackerCard();
      renderSplitPlanner();
      renderSplitCalendar();
      renderNutritionCard();
    }
    else if(e.key === 'la_gym_split'){
      renderSplitPlanner();
      renderSplitCalendar();
    }
    else if(e.key === 'la_nutrition'){
      renderNutritionCard();
    }
  }
  window.addEventListener('storage', handleStorageSync);
  window.addEventListener('state-change', function(e){ handleStorageSync({ key: e.detail.key }); });

  /* ============================================================
     Imported Apple Health data → card rendering
  ============================================================ */
  function getHealthArr(key){
    try{
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch(e){ return []; }
  }

  function last7ISODates(){
    var arr = [];
    var now = new Date();
    for(var i = 6; i >= 0; i--){
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      arr.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
    }
    return arr;
  }
  function dowLabel(iso){
    var labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return labels[new Date(iso + 'T00:00:00').getDay()];
  }

  /* ============================================================
     Monthly Tracker card — reads real la_checkin_night_<date> records
     (written from index.html's Night check-in — this page has no
     Night modal of its own, it only displays what was logged there)
     for the "Done" (productive) and "Mood" columns, and for the
     Reflections panel. The "Wheel" column reads index.html's
     la_wheel_history_<date> snapshots (see saveWheelSnapshot() there).
  ============================================================ */
  var NIGHT_MOOD_COLORS = { Excited:'#4ade80', Content:'#86efac', Anxious:'#fbbf24', Sad:'#f87171', Depressed:'#ef4444', Drained:'#94a3b8' };

  var monthlyTrackerViewYear = null;
  var monthlyTrackerViewMonth = null;

  function isoForMonthDay(year, month, day){
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function wheelDotBackground(pct){
    pct = Math.max(0, Math.min(100, pct));
    var hue = 120 + (pct / 100) * 120;
    return 'conic-gradient(hsl(' + hue.toFixed(1) + ',42%,42%) ' + pct.toFixed(2) + '%, rgba(255,255,255,0.06) ' + pct.toFixed(2) + '%)';
  }

  function renderMonthlyTrackerCard(){
    var grid = document.getElementById('monthly-tracker-grid');
    var reflectionBody = document.getElementById('monthly-tracker-reflection');
    if(!grid || !reflectionBody) return;

    var now = new Date();
    var year = monthlyTrackerViewYear !== null ? monthlyTrackerViewYear : now.getFullYear();
    var month = monthlyTrackerViewMonth !== null ? monthlyTrackerViewMonth : now.getMonth();
    var isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    var todayDate = isCurrentMonth ? now.getDate() : -1;
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var monthLabelEl = document.getElementById('monthly-tracker-month');
    if(monthLabelEl) monthLabelEl.textContent = SPLIT_MONTH_NAMES[month] + ' ' + year;

    var rows = '';
    var reflections = [];
    for(var day = 1; day <= daysInMonth; day++){
      var iso = isoForMonthDay(year, month, day);
      var checkin = loadJSON('la_checkin_night_' + iso, null);
      var wheelHistory = loadJSON('la_wheel_history_' + iso, null);
      var wheelBg = wheelHistory ? wheelDotBackground(wheelHistory.totalPct) : 'rgba(255,255,255,0.06)';
      var rowCls = day === todayDate ? ' monthly-tracker-row-today' : '';
      var checkHtml = checkin
        ? '<span class="material-symbols-outlined monthly-check-icon ' + (checkin.productive ? 'done' : 'not-done') + '" title="' + (checkin.productive ? 'Productive' : 'Not productive') + '">' + (checkin.productive ? 'check_circle' : 'remove_circle') + '</span>'
        : '<span class="material-symbols-outlined monthly-check-icon not-done">remove_circle</span>';
      var moodColor = checkin && checkin.mood ? NIGHT_MOOD_COLORS[checkin.mood] : null;
      var moodHtml = moodColor
        ? '<span class="monthly-mood-dot" style="background:' + moodColor + ';" title="' + escapeHtml(checkin.mood) + '"></span>'
        : '<span class="monthly-mood-dot empty"></span>';
      rows +=
        '<div class="monthly-tracker-cell' + rowCls + '"><span class="monthly-tracker-day-label">' + day + '</span></div>' +
        '<div class="monthly-tracker-cell' + rowCls + '" title="Day ' + day + (wheelHistory ? ' — ' + Math.round(wheelHistory.totalPct) + '%' : '') + '"><span class="monthly-wheel-dot" style="background:' + wheelBg + ';"></span></div>' +
        '<div class="monthly-tracker-cell' + rowCls + '">' + checkHtml + '</div>' +
        '<div class="monthly-tracker-cell' + rowCls + '">' + moodHtml + '</div>';
      if(checkin && checkin.reflection){ reflections.push({ iso: iso, text: checkin.reflection }); }
    }
    grid.innerHTML = rows;

    if(!reflections.length){
      reflectionBody.innerHTML = '<div class="monthly-tracker-reflection-empty">Reflections you add in the Night check-in will appear here.</div>';
    } else {
      reflections.sort(function(a, b){ return a.iso < b.iso ? 1 : -1; });
      reflectionBody.innerHTML = reflections.map(function(r){
        return '<div class="monthly-reflection-row"><span class="date">' + formatDateHuman(r.iso) + '</span><span class="sentence">' + escapeHtml(r.text) + '</span></div>';
      }).join('');
    }
  }

  function getSavedMonthlyTrackerMonths(){
    var seen = {};
    for(var i = 0; i < localStorage.length; i++){
      var key = localStorage.key(i);
      var m = key && key.match(/^la_(?:wheel_history|checkin_night)_(\d{4})-(\d{2})-\d{2}$/);
      if(m) seen[m[1] + '-' + m[2]] = true;
    }
    return Object.keys(seen).sort().reverse();
  }

  function openMonthlyHistoryModal(){
    var list = document.getElementById('monthly-history-list');
    if(!list) return;
    var months = getSavedMonthlyTrackerMonths();
    var now = new Date();
    var curYear = now.getFullYear(), curMonth = now.getMonth();
    if(months.indexOf(curYear + '-' + String(curMonth + 1).padStart(2, '0')) === -1){
      months.unshift(curYear + '-' + String(curMonth + 1).padStart(2, '0'));
      months.sort().reverse();
    }
    var viewYear = monthlyTrackerViewYear !== null ? monthlyTrackerViewYear : curYear;
    var viewMonth = monthlyTrackerViewMonth !== null ? monthlyTrackerViewMonth : curMonth;

    if(!months.length){
      list.innerHTML = '<div class="monthly-history-empty">No saved months yet.</div>';
    } else {
      list.innerHTML = months.map(function(key){
        var parts = key.split('-');
        var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1;
        var isCurCal = (y === curYear && m === curMonth);
        var isSelected = (y === viewYear && m === viewMonth);
        return '<div class="monthly-history-item' + (isSelected ? ' current' : '') + '" onclick="selectMonthlyTrackerMonth(' + y + ',' + m + ')">' +
          '<span class="label">' + SPLIT_MONTH_NAMES[m] + ' ' + y + '</span>' +
          (isCurCal ? '<span class="tag">Current</span>' : '') +
          '</div>';
      }).join('');
    }
    openModal('monthly-history-modal');
  }

  function selectMonthlyTrackerMonth(year, month){
    monthlyTrackerViewYear = year;
    monthlyTrackerViewMonth = month;
    var now = new Date();
    if(year === now.getFullYear() && month === now.getMonth()){
      monthlyTrackerViewYear = null;
      monthlyTrackerViewMonth = null;
    }
    renderMonthlyTrackerCard();
    closeModal('monthly-history-modal');
  }

  function fmtAxisSteps(v){
    if(v >= 1000){
      var k = Math.round((v / 1000) * 10) / 10;
      return k + 'k';
    }
    return Math.round(v).toString();
  }
  function fmtAxisCal(v){ return Math.round(v).toString(); }

  function buildAxisTicks(maxVal, formatFn, tickFirst){
    var count = 4;
    var html = '';
    for(var i = 0; i <= count; i++){
      var v = maxVal - (maxVal / count) * i;
      var label = formatFn(v);
      html += tickFirst
        ? '<span><i class="tick"></i>' + label + '</span>'
        : '<span>' + label + '<i class="tick"></i></span>';
    }
    return html;
  }

  function renderActivityCard(){
    var stepsArr = getHealthArr('la_health_steps');
    var caloriesArr = getHealthArr('la_health_calories');
    var workoutsArr = getHealthArr('la_health_workouts');
    var hasAny = stepsArr.length || caloriesArr.length || workoutsArr.length;
    document.getElementById('activity-empty-note').style.display = hasAny ? 'none' : 'block';

    var days = last7ISODates();
    var stepsByDate = {}; stepsArr.forEach(function(s){ stepsByDate[s.date] = s.steps; });
    var calByDate = {}; caloriesArr.forEach(function(c){ calByDate[c.date] = c.calories; });

    var stepsWithData = days.filter(function(d){ return stepsByDate[d] != null; });
    var avgSteps = stepsWithData.length ? Math.round(stepsWithData.reduce(function(sum, d){ return sum + stepsByDate[d]; }, 0) / stepsWithData.length) : 0;
    var calWithData = days.filter(function(d){ return calByDate[d] != null; });
    var avgCal = calWithData.length ? Math.round(calWithData.reduce(function(sum, d){ return sum + calByDate[d]; }, 0) / calWithData.length) : 0;
    document.getElementById('activity-avg-steps').textContent = avgSteps.toLocaleString();
    document.getElementById('activity-avg-cal').textContent = avgCal.toLocaleString();

    var maxSteps = Math.max.apply(null, days.map(function(d){ return stepsByDate[d] || 0; }).concat([1]));
    var maxCal = Math.max.apply(null, days.map(function(d){ return calByDate[d] || 0; }).concat([1]));
    document.getElementById('activity-bar-chart').innerHTML = days.map(function(d){
      var s = stepsByDate[d] || 0, c = calByDate[d] || 0;
      var sh = Math.max(3, Math.round((s / maxSteps) * 100));
      var ch = Math.max(3, Math.round((c / maxCal) * 100));
      var title = dowLabel(d) + ': ' + s.toLocaleString() + ' steps · ' + Math.round(c).toLocaleString() + ' kcal';
      return '<div class="activity-bar-group" title="' + title + '">' +
        '<div class="activity-bar steps" style="height:' + sh + '%;"></div>' +
        '<div class="activity-bar cal" style="height:' + ch + '%;"></div>' +
      '</div>';
    }).join('');
    document.getElementById('activity-bar-days').innerHTML = days.map(function(d){ return '<span>' + dowLabel(d) + '</span>'; }).join('');

    document.getElementById('activity-axis-steps').innerHTML = buildAxisTicks(maxSteps, fmtAxisSteps, false);
    document.getElementById('activity-axis-cal').innerHTML = buildAxisTicks(maxCal, fmtAxisCal, true);

    var isWalk = function(w){ return /walk/i.test(w.type); };
    var isStrength = function(w){ return /strength/i.test(w.type); };

    var twoWeeksAgo = addDaysISO(todayISO(), -13);
    var walks = workoutsArr.filter(function(w){ return isWalk(w) && w.date >= twoWeeksAgo; });
    var walkAvgEl = document.getElementById('activity-walk-avg');
    if(walks.length){
      var avgWalk = Math.round(walks.reduce(function(sum, w){ return sum + w.duration; }, 0) / walks.length);
      walkAvgEl.classList.remove('empty');
      walkAvgEl.innerHTML = avgWalk + ' <span class="unit">min avg</span>';
    } else {
      walkAvgEl.classList.add('empty');
      walkAvgEl.textContent = 'No walks in the past 2 weeks';
    }

    var strengthSessions = workoutsArr.filter(isStrength);
    var strengthListEl = document.getElementById('activity-strength-list');
    if(!strengthSessions.length){
      strengthListEl.innerHTML = '<div class="activity-workout-empty">No strength sessions yet</div>';
    } else {
      strengthListEl.innerHTML = strengthSessions.map(function(w){
        return '<div class="activity-strength-row">' +
          '<div><div class="name">' + escapeHtml(w.type) + '</div><div class="date">' + formatDateHuman(w.date) + '</div></div>' +
          '<div class="dur">' + Math.round(w.duration) + 'm</div>' +
        '</div>';
      }).join('');
    }
  }

  function getNutritionConfig(){
    var cfg = loadJSON('la_nutrition', null);
    if(!cfg){ cfg = { target:2200, entries:{} }; saveJSON('la_nutrition', cfg); }
    if(cfg.target == null) cfg.target = 2200;
    if(!cfg.entries) cfg.entries = {};
    return cfg;
  }

  function updateNutritionToday(value){
    var cfg = getNutritionConfig();
    var today = getAdjustedDate();
    var num = parseFloat(value);
    if(value === '' || isNaN(num)){ delete cfg.entries[today]; }
    else { cfg.entries[today] = num; }
    saveJSON('la_nutrition', cfg);
    renderNutritionCard();
  }

  function updateNutritionTarget(value){
    var cfg = getNutritionConfig();
    var num = parseFloat(value);
    cfg.target = isNaN(num) ? 2200 : num;
    saveJSON('la_nutrition', cfg);
    renderNutritionCard();
  }

  function renderNutritionCard(){
    var cfg = getNutritionConfig();
    var days = last7ISODates();
    var today = getAdjustedDate();

    var todayInput = document.getElementById('nutrition-today-input');
    var targetInput = document.getElementById('nutrition-target-input');
    if(document.activeElement !== todayInput) todayInput.value = cfg.entries[today] != null ? cfg.entries[today] : '';
    if(document.activeElement !== targetInput) targetInput.value = cfg.target;

    var values = days.map(function(d){
      if(cfg.entries[d] != null) return cfg.entries[d];
      var checkin = loadJSON('la_checkin_night_' + d, null);
      if(checkin && checkin.calorieTarget === 'Yes') return cfg.target;
      if(checkin && checkin.calorieTarget === 'No') return Math.round(cfg.target * 1.15);
      return null;
    });

    var maxVal = Math.max.apply(null, values.map(function(v){ return v || 0; }).concat([cfg.target || 1]));
    var scaleMax = maxVal * 1.15;

    document.getElementById('nutrition-chart').innerHTML = values.map(function(v, i){
      if(v == null) return '<div class="nutrition-bar empty" style="height:2%;" title="' + dowLabel(days[i]) + ': no data"></div>';
      var h = Math.max(3, Math.round((v / scaleMax) * 100));
      var cls = v <= cfg.target ? 'under' : 'over';
      return '<div class="nutrition-bar ' + cls + '" style="height:' + h + '%;" title="' + dowLabel(days[i]) + ': ' + Math.round(v) + ' kcal"></div>';
    }).join('');

    document.getElementById('nutrition-day-labels').innerHTML = days.map(function(d){ return '<span>' + dowLabel(d) + '</span>'; }).join('');
    document.getElementById('nutrition-axis').innerHTML = buildAxisTicks(scaleMax, fmtAxisCal, false);

    var lineY = Math.max(0, Math.min(100, Math.round((cfg.target / scaleMax) * 100)));
    document.getElementById('nutrition-target-line').style.bottom = lineY + '%';

    var loggedVals = values.filter(function(v){ return v != null; });
    var weeklyAvgEl = document.getElementById('nutrition-weekly-avg');
    if(loggedVals.length){
      var avg = Math.round(loggedVals.reduce(function(a, b){ return a + b; }, 0) / loggedVals.length);
      weeklyAvgEl.classList.remove('empty');
      weeklyAvgEl.innerHTML = avg.toLocaleString() + ' <span class="unit">kcal avg</span>';
    } else {
      weeklyAvgEl.classList.add('empty');
      weeklyAvgEl.textContent = 'No logged days yet';
    }
  }

  function buildSparklineSVG(values, color){
    if(!values.length) return '';
    var w = 100, h = 30;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = (max - min) || 1;
    var step = values.length > 1 ? w / (values.length - 1) : 0;
    var points = values.map(function(v, i){
      var x = Math.round(i * step);
      var y = Math.round(h - ((v - min) / range) * h);
      return x + ',' + y;
    }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function buildSparklineAxis(values, formatFn){
    if(!values.length) return '';
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    return '<span>' + formatFn(max) + '</span><span>' + formatFn(min) + '</span>';
  }
  function fmtAxisWeight(v){ return (Math.round(v * 10) / 10).toString(); }

  function renderBiometricsCard(){
    var weightArr = getHealthArr('la_health_weight');
    var hrvArr = getHealthArr('la_health_hrv');
    var vo2Arr = getHealthArr('la_health_vo2');
    var rhrArr = getHealthArr('la_health_rhr');

    if(weightArr.length){
      var w = weightArr[weightArr.length - 1];
      var weightVals = weightArr.slice(-30).map(function(x){ return x.value; });
      document.getElementById('bio-weight-value').innerHTML = w.value.toFixed(1) + ' <span class="unit">lbs</span>';
      document.getElementById('bio-weight-sparkline').innerHTML = buildSparklineSVG(weightVals, '#fb7185');
      document.getElementById('bio-weight-axis').innerHTML = buildSparklineAxis(weightVals, fmtAxisWeight);
    } else {
      document.getElementById('bio-weight-value').textContent = '—';
      document.getElementById('bio-weight-axis').innerHTML = '';
      document.getElementById('bio-weight-sparkline').innerHTML = '<div class="bio-tile-empty">Import Apple Health</div>';
    }

    if(hrvArr.length){
      var h = hrvArr[hrvArr.length - 1];
      var hrvVals = hrvArr.slice(-30).map(function(x){ return x.value; });
      document.getElementById('bio-hrv-value').innerHTML = Math.round(h.value) + ' <span class="unit">ms</span>';
      document.getElementById('bio-hrv-sparkline').innerHTML = buildSparklineSVG(hrvVals, '#fb7185');
      document.getElementById('bio-hrv-axis').innerHTML = buildSparklineAxis(hrvVals, fmtAxisCal);
    } else {
      document.getElementById('bio-hrv-value').textContent = '—';
      document.getElementById('bio-hrv-axis').innerHTML = '';
      document.getElementById('bio-hrv-sparkline').innerHTML = '<div class="bio-tile-empty">Import Apple Health</div>';
    }

    var trendEl = document.getElementById('bio-vo2-trend');
    if(vo2Arr.length){
      var v = vo2Arr[vo2Arr.length - 1];
      document.getElementById('bio-vo2-value').textContent = v.value.toFixed(1);
      if(vo2Arr.length > 1){
        var prev = vo2Arr[vo2Arr.length - 2].value;
        if(v.value > prev){ trendEl.className = 'bio-trend up'; trendEl.innerHTML = '<span class="material-symbols-outlined">trending_up</span>Improving'; }
        else if(v.value < prev){ trendEl.className = 'bio-trend down'; trendEl.innerHTML = '<span class="material-symbols-outlined">trending_down</span>Declining'; }
        else { trendEl.className = 'bio-trend flat'; trendEl.innerHTML = '<span class="material-symbols-outlined">trending_flat</span>Stable'; }
      } else {
        trendEl.className = 'bio-trend flat';
        trendEl.innerHTML = '<span class="material-symbols-outlined">trending_flat</span>Not enough data';
      }
    } else {
      document.getElementById('bio-vo2-value').textContent = '—';
      trendEl.className = 'bio-trend';
      trendEl.innerHTML = '<span class="bio-tile-empty">Import Apple Health</span>';
    }

    if(rhrArr.length){
      var r = rhrArr[rhrArr.length - 1];
      var rhrVals = rhrArr.slice(-7).map(function(x){ return x.value; });
      document.getElementById('bio-rhr-value').innerHTML = Math.round(r.value) + ' <span class="unit">bpm</span>';
      document.getElementById('bio-rhr-sparkline').innerHTML = buildSparklineSVG(rhrVals, '#fb7185');
      document.getElementById('bio-rhr-axis').innerHTML = buildSparklineAxis(rhrVals, fmtAxisCal);
    } else {
      document.getElementById('bio-rhr-value').textContent = '—';
      document.getElementById('bio-rhr-axis').innerHTML = '';
      document.getElementById('bio-rhr-sparkline').innerHTML = '<div class="bio-tile-empty">Import Apple Health</div>';
    }
  }

  function renderHealthCards(){
    renderActivityCard();
    renderBiometricsCard();
  }

  /* ============================================================
     Daily reset at 5AM — refresh check-in badges and nutrition
     entry for the new day. Only fires once
     per adjusted day (la_last_reset_date, 5AM-adjusted YYYY-MM-DD).
     checkDailyReset/performDailyReset/runClockTick/
     updateLateNightMode/updateSidebarDateTime/clearTodayNutritionEntry
     now live in js/core/daily-reset.js; this page just registers its
     extra reset steps as a hook.
  ============================================================ */
  registerDailyResetHook(function(){
    clearTodayNutritionEntry();
    if(typeof renderMonthlyTrackerCard === 'function'){ renderMonthlyTrackerCard(); }
    if(typeof renderSplitPlanner === 'function'){ renderSplitPlanner(); }
    if(typeof renderSplitCalendar === 'function'){ renderSplitCalendar(); }
    if(typeof renderNutritionCard === 'function'){ renderNutritionCard(); }
  });

  /* ============================================================
     Weather mini card — now lives in js/weather-widget.js
  ============================================================ */

  /* ============================================================
     Spotify mini card — now lives in js/spotify-widget.js
  ============================================================ */

  /* ============================================================
     YouTube mini card — now lives in js/youtube-widget.js
  ============================================================ */

  /* ============================================================
     Init
  ============================================================ */
  renderHealthCards();
  renderSplitPlanner();
  renderSplitCalendar();
  renderMonthlyTrackerCard();
  renderNutritionCard();
  loadWeather();
  initSpotifyWidget();
  initYoutubeWidget();
  updateSidebarDateTime();
  setInterval(updateSidebarDateTime, 1000);
  runClockTick();
  setInterval(runClockTick, 60000);
