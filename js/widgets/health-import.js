/* ============================================================
   Apple Health Import (export.xml, chunk-streamed, string-matched)
   — shared by every page (index.html, financial-subpage.html,
   screens/*.html). Byte-identical across all 5 pages before this
   extraction; verified via diff before moving here.
   Depends on js/core.js and js/core/daily-reset.js (openModal/
   closeModal) (load those first).
============================================================ */
(function(){
  'use strict';

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

  window.openImportModal = openImportModal;
  window.closeImportModal = closeImportModal;
  window.resetImportModal = resetImportModal;
  window.formatHealthBytes = formatHealthBytes;
  window.startHealthImport = startHealthImport;
  window.readHealthChunk = readHealthChunk;
  window.processHealthBuffer = processHealthBuffer;
  window.parseHealthAttrs = parseHealthAttrs;
  window.healthDateStr = healthDateStr;
  window.healthHour = healthHour;
  window.healthAddDays = healthAddDays;
  window.setHealthStatus = setHealthStatus;
  window.handleHealthRecord = handleHealthRecord;
  window.handleHealthSleep = handleHealthSleep;
  window.handleHealthWorkout = handleHealthWorkout;
  window.finishHealthImport = finishHealthImport;
  window.showHealthImportSummary = showHealthImportSummary;
})();
