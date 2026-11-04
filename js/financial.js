/* ============================================================
   Financial subpage — extracted from financial-subpage.html's
   two inline <script> blocks (main page logic, then the PIN
   gate), concatenated here in their original execution order.
   Page-specific logic only (the PIN gate is intentionally
   financial-only, never shared — see its own header below).
   Depends on js/core.js, js/weather-widget.js,
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
      if(document.body.classList.contains('pin-unlocked')){
        var openModals = document.querySelectorAll('.modal-overlay.open');
        if(openModals.length){
          openModals.forEach(function(o){ o.classList.remove('open'); });
          return;
        }
      }
      exitFinancial();
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
  function diffDaysISO(aISO, bISO){
    var a = new Date(aISO + 'T00:00:00');
    var b = new Date(bISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  /* ============================================================
     Financial helpers — formatting
  ============================================================ */
  function formatCurrency(n){
    n = n || 0;
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  /* ============================================================
     Spending Log — la_spending_log
  ============================================================ */
  var SPENDING_CATEGORY_ICONS = {
    Food:'restaurant', Transport:'directions_car', Shopping:'shopping_bag',
    Subscriptions:'subscriptions', Entertainment:'theaters', Health:'favorite', Other:'category'
  };
  var editingSpendingId = null;

  function getSpendingLog(){ return loadJSON('la_spending_log', []); }
  function saveSpendingLog(list){ saveJSON('la_spending_log', list); }

  function openSpendingModal(id){
    editingSpendingId = id || null;
    var entry = id ? getSpendingLog().find(function(x){ return x.id === id; }) : null;
    document.getElementById('spending-modal-title').textContent = id ? 'Edit Entry' : 'Add Entry';
    document.getElementById('spending-amount-input').value = entry ? entry.amount : '';
    document.getElementById('spending-category-input').value = entry ? entry.category : 'Food';
    document.getElementById('spending-note-input').value = entry ? entry.note : '';
    document.getElementById('spending-date-input').value = entry ? entry.date : getAdjustedDate();
    document.getElementById('spending-delete-btn').style.display = id ? 'inline-flex' : 'none';
    openModal('spending-modal');
  }
  function closeSpendingModal(){ closeModal('spending-modal'); editingSpendingId = null; }

  function saveSpendingForm(){
    var amount = parseFloat(document.getElementById('spending-amount-input').value);
    if(isNaN(amount)) return;
    var category = document.getElementById('spending-category-input').value;
    var note = document.getElementById('spending-note-input').value.trim();
    var date = document.getElementById('spending-date-input').value || getAdjustedDate();
    var list = getSpendingLog();
    var isNewEntry = !editingSpendingId;
    if(editingSpendingId){
      var e = list.find(function(x){ return x.id === editingSpendingId; });
      if(e){ e.amount = amount; e.category = category; e.note = note; e.date = date; }
    } else {
      list.push({ id: uid(), amount: amount, category: category, note: note, date: date });
    }
    saveSpendingLog(list);
    closeSpendingModal();
    renderSpendingLog();

    /* Income-type entries (amount >= 0, e.g. a manual reimbursement)
       still adjust Cash on Hand directly, same as savePaydayEntry's
       paycheck income — Current Net's live subtraction only ever
       accounts for expense-type (amount < 0) entries, so income needs
       to land in the anchor itself or it wouldn't affect Current Net
       at all. Expense entries deliberately do NOT touch cash here —
       Current Net subtracts this cycle's passed expenses live, so
       mutating cash directly here too would double-count them. */
    if(isNewEntry && amount > 0){
      saveJSON('la_cash_on_hand', getCashOnHand() + amount);
    }
    renderCurrentNet();
  }

  function deleteSpendingEntry(){
    if(!editingSpendingId) return;
    saveSpendingLog(getSpendingLog().filter(function(x){ return x.id !== editingSpendingId; }));
    closeSpendingModal();
    renderSpendingLog();
  }

  function spendingRowHtml(e){
    var isExpense = e.amount < 0;
    var icon = SPENDING_CATEGORY_ICONS[e.category] || 'category';
    return '<div class="fin-spending-row" onclick="openSpendingModal(\''+e.id+'\')">' +
        '<div class="fin-spending-row-left">' +
          '<span class="material-symbols-outlined fin-spending-icon">'+icon+'</span>' +
          '<div class="fin-spending-row-text">' +
            '<div class="fin-spending-note">'+escapeHtml(e.note || e.category)+'</div>' +
            '<div class="fin-spending-date mono">'+formatDateHuman(e.date)+'</div>' +
          '</div>' +
        '</div>' +
        '<div class="fin-spending-amount mono '+(isExpense ? 'expense' : 'income')+'">'+formatCurrency(e.amount)+'</div>' +
      '</div>';
  }

  function renderSpendingLog(){
    var all = getSpendingLog();
    var today = getAdjustedDate();
    var cycleStart = getCurrentCycleStartDate();
    /* Scoped to the current paycheck cycle only — this is the "clear/
       archive on Paycheck Reset" requirement, achieved non-destructively
       by date-filtering rather than deleting: once a new cycle starts,
       older entries simply fall before cycleStart and stop appearing
       here, while remaining in la_spending_log for history/audit. */
    var list = all.filter(function(e){ return e.date <= today && e.date >= cycleStart; }).sort(function(a,b){ return b.date.localeCompare(a.date); });

    var wrap = document.getElementById('spending-list');
    if(!list.length){
      wrap.innerHTML = '<div class="fin-empty">No spending logged yet</div>';
    } else {
      wrap.innerHTML = list.map(function(e){ return spendingRowHtml(e); }).join('');
    }
    var monthPrefix = today.slice(0,7);
    var monthTotal = all.filter(function(e){ return e.date <= today && e.date.slice(0,7) === monthPrefix; })
      .reduce(function(sum, e){ return sum + e.amount; }, 0);
    var totalEl = document.getElementById('spending-total-value');
    totalEl.textContent = formatCurrency(monthTotal);
    totalEl.classList.toggle('negative', monthTotal < 0);
    totalEl.classList.toggle('positive', monthTotal >= 0);

    renderProjectedCard();
  }

  /* ============================================================
     Monthly Budget — la_paycheck (single object)
  ============================================================ */
  function getPaycheck(){ return loadJSON('la_paycheck', { amount:0, frequency:'biweekly' }); }

  function updatePaycheckAmount(value){
    var p = getPaycheck();
    p.amount = parseFloat(value) || 0;
    saveJSON('la_paycheck', p);
    renderBudgetCard();
  }
  function updatePaycheckFrequency(value){
    var p = getPaycheck();
    p.frequency = value;
    saveJSON('la_paycheck', p);
    renderBudgetCard();
  }
  function renderPaycheckInputs(){
    var p = getPaycheck();
    var amtInput = document.getElementById('paycheck-amount-input');
    var freqSelect = document.getElementById('paycheck-frequency-select');
    if(document.activeElement !== amtInput) amtInput.value = p.amount || '';
    freqSelect.value = p.frequency || 'monthly';
  }
  function getMonthlyIncome(){
    var p = getPaycheck();
    var amt = parseFloat(p.amount) || 0;
    if(p.frequency === 'weekly') return amt * 52 / 12;
    if(p.frequency === 'biweekly') return amt * 26 / 12;
    return amt;
  }

  /* ============================================================
     Jobs / Hourly Wages — la_jobs (fixed 2-slot array: name + rate only)
     Hours are NOT stored here — they read/write directly from
     la_kranker_hours / la_ballard_hours, the same keys the academic
     page's research-hour counters use, so both pages stay in sync
     (this page picks up cross-tab edits via the storage listener below).
  ============================================================ */
  var JOB_TAX_RATE = 0.0495; // effective rate from last paycheck: $907 gross, $44.85 taxes -> multiplier 0.9505
  var PROJECTED_JOB_LABS = ['kranker', 'ballard'];
  var PROJECTED_JOB_DEFAULT_NAMES = ['Kranker Lab', 'Ballard Lab'];

  function getJobs(){
    var jobs = loadJSON('la_jobs', null);
    if(!jobs || !jobs.length) jobs = [];
    jobs = jobs.slice(0, 2);
    while(jobs.length < 2){
      jobs.push({ name: PROJECTED_JOB_DEFAULT_NAMES[jobs.length], hourlyRate: 0 });
    }
    return jobs;
  }
  function saveJobs(jobs){ saveJSON('la_jobs', jobs); }

  function jobAfterTaxRate(hourly){ return hourly * (1 - JOB_TAX_RATE); }

  function updateJobField(index, field, value){
    var jobs = getJobs();
    if(field === 'name') jobs[index].name = value;
    else if(field === 'hourlyRate') jobs[index].hourlyRate = parseFloat(value) || 0;
    saveJobs(jobs);
    renderJobsCard();
    renderProjectedCard();
  }

  function getLabHours(lab){ return parseFloat(loadJSON('la_' + lab + '_hours', 0)) || 0; }
  function saveLabHoursValue(lab, val){ saveJSON('la_' + lab + '_hours', val); }

  function adjustProjectedHours(index, delta){
    var lab = PROJECTED_JOB_LABS[index];
    var val = getLabHours(lab) + delta;
    if(val < 0) val = 0;
    val = Math.round(val * 10) / 10;
    saveLabHoursValue(lab, val);
    renderProjectedCard();
  }
  function editProjectedHours(index){
    var lab = PROJECTED_JOB_LABS[index];
    var valueEl = document.getElementById('projected-hours-value-' + index);
    var input = document.getElementById('projected-hours-input-' + index);
    valueEl.style.display = 'none';
    input.style.display = '';
    input.value = getLabHours(lab).toFixed(1);
    input.focus();
    input.select();
  }
  function saveProjectedHoursText(index, value){
    var lab = PROJECTED_JOB_LABS[index];
    var valueEl = document.getElementById('projected-hours-value-' + index);
    var input = document.getElementById('projected-hours-input-' + index);
    var v = parseFloat(value);
    if(isNaN(v) || v < 0) v = getLabHours(lab);
    v = Math.round(v * 10) / 10;
    saveLabHoursValue(lab, v);
    input.style.display = 'none';
    valueEl.style.display = '';
    renderProjectedCard();
  }

  function jobEarnedThisPeriod(index){
    var job = getJobs()[index];
    var hours = getLabHours(PROJECTED_JOB_LABS[index]);
    return hours * jobAfterTaxRate(parseFloat(job.hourlyRate) || 0);
  }

  function getTotalEarnedThisPeriod(){
    return [0, 1].reduce(function(sum, i){ return sum + jobEarnedThisPeriod(i); }, 0);
  }

  function renderJobsCard(){
    var jobs = getJobs();
    jobs.forEach(function(job, i){
      var nameInput = document.getElementById('job-name-input-' + i);
      var rateInput = document.getElementById('job-rate-input-' + i);
      var afterTaxEl = document.getElementById('job-aftertax-' + i);
      if(document.activeElement !== nameInput) nameInput.value = job.name || '';
      if(document.activeElement !== rateInput) rateInput.value = job.hourlyRate || '';
      var hourly = parseFloat(job.hourlyRate) || 0;
      afterTaxEl.textContent = hourly > 0 ? (formatCurrency(hourly) + '/hr → ' + formatCurrency(jobAfterTaxRate(hourly)) + '/hr after tax') : '';
    });
  }

  function openJobsSettingsModal(){
    renderJobsCard();
    openModal('jobs-settings-modal');
  }

  /* ============================================================
     Paycheck Date Engine — fully computed, no stored/user-editable
     date. Paychecks land every 14 days starting from
     PAYCHECK_BASE_DATE, forever. Rollover checks use true system
     midnight (getTrueTodayISO) rather than the adjusted 5 AM
     productivity date used everywhere else in this app — a paycheck
     lands on the calendar day it lands on, independent of when the
     user's "day" resets for habit/task-tracking purposes.

     Checked once per real calendar day via performDailyReset(). The
     instant today reaches/passes the next scheduled paycheck date:
     la_kranker_hours/la_ballard_hours reset to 0, a full Paycheck
     Cycle Reset runs (Current Net re-anchors Cash on Hand, Spending
     Log's current-cycle window rolls forward), and the payout modal
     opens so the user can log actual amounts received.
  ============================================================ */
  var PAYCHECK_BASE_DATE = '2026-07-24';
  var PAYCHECK_INTERVAL_DAYS = 14;

  /* Real calendar date at standard midnight — deliberately NOT
     getAdjustedDate(), which shifts before-5-AM back a day for
     productivity tracking. Paycheck timing is a hard financial fact
     and must never be affected by that shift. */
  function getTrueTodayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  /* Start date of the CURRENT paycheck cycle: the most recent
     scheduled paycheck date <= today (true midnight), or
     PAYCHECK_BASE_DATE if today predates it entirely. Today landing
     exactly on a scheduled paycheck date makes TODAY the new cycle's
     start, not "next" — see getNextPaycheckDate below. */
  function getCurrentCycleStartDate(){
    var today = getTrueTodayISO();
    if(today < PAYCHECK_BASE_DATE) return PAYCHECK_BASE_DATE;
    var iso = PAYCHECK_BASE_DATE;
    var guard = 0;
    while(addDaysISO(iso, PAYCHECK_INTERVAL_DAYS) <= today && guard++ < 2000){
      iso = addDaysISO(iso, PAYCHECK_INTERVAL_DAYS);
    }
    return iso;
  }

  /* Next scheduled paycheck date — always exactly current-cycle-start
     + 14 days, so "today" is always strictly before it by
     construction (today landing on a paycheck date makes that date
     the CURRENT cycle's start, per getCurrentCycleStartDate, not the
     upcoming one). Recurring/Planned "due before next paycheck"
     windows below all compare against this with a strict `<`. */
  function getNextPaycheckDate(){
    return addDaysISO(getCurrentCycleStartDate(), PAYCHECK_INTERVAL_DAYS);
  }

  function renderNextPaydayNote(){
    var el = document.getElementById('fin-next-payday-note');
    if(el) el.textContent = 'Next payday: ' + formatDateHuman(getNextPaycheckDate());
  }

  function openPaydayModal(){
    var jobs = getJobs();
    document.getElementById('payday-job1-label').textContent = (jobs[0].name || 'Job 1') + ' Actual Payout';
    document.getElementById('payday-job2-label').textContent = (jobs[1].name || 'Job 2') + ' Actual Payout';
    document.getElementById('payday-job1-input').value = '';
    document.getElementById('payday-job2-input').value = '';
    openModal('payday-modal');
  }

  function savePaydayEntry(){
    var amt1 = parseFloat(document.getElementById('payday-job1-input').value) || 0;
    var amt2 = parseFloat(document.getElementById('payday-job2-input').value) || 0;
    var total = amt1 + amt2;
    if(total > 0){
      var jobs = getJobs();
      var names = jobs.map(function(j){ return j.name; }).filter(Boolean);
      var list = getSpendingLog();
      list.push({ id: uid(), amount: total, category: 'Other', note: 'Paycheck' + (names.length ? ': ' + names.join(' + ') : ''), date: getAdjustedDate() });
      saveSpendingLog(list);
      saveJSON('la_cash_on_hand', getCashOnHand() + total);
      renderSpendingLog();
      renderCurrentNet();

      var history = loadJSON('la_payday_history', []);
      history.push({ date: getAdjustedDate(), total: total });
      saveJSON('la_payday_history', history.slice(-12));
    }
    closeModal('payday-modal');
  }

  /* Current Net for an arbitrary [startISO, endISO] window — used by
     performPaycheckCycleReset to close out the JUST-ENDED cycle
     (whose window is no longer "current" by the time the reset runs)
     without duplicating getCurrentNetValue's live-window logic. */
  function computeNetForWindow(startISO, endISO){
    var cash = getCashOnHand();
    var passedExpenses = getSpendingLog()
      .filter(function(e){ return e.amount < 0 && e.date >= startISO && e.date <= endISO; })
      .reduce(function(sum, e){ return sum + Math.abs(e.amount); }, 0);
    return cash - passedExpenses;
  }

  /* Paycheck Cycle Reset: re-anchors Cash on Hand to Current Net as
     computed over the cycle that just ended (i.e. "what's actually
     left after that cycle's spending" becomes the new starting
     balance), resets lab hours, and refreshes every financial module.
     Old Spending Log entries are never deleted — they simply fall
     before the new cycle's start date, so Current/Projected Net's
     cycle-scoped sums naturally stop counting them ("archived" by
     falling out of the active window, not by data loss). */
  function performPaycheckCycleReset(oldCycleStartISO, oldCycleEndISO){
    var preResetNet = computeNetForWindow(oldCycleStartISO, oldCycleEndISO);
    saveJSON('la_cash_on_hand', preResetNet);
    PROJECTED_JOB_LABS.forEach(function(lab){ saveLabHoursValue(lab, 0); });

    renderSpendingLog();
    renderRecurringEverywhere();

    openPaydayModal();
  }

  function checkPaycheckCycleReset(){
    var cycleStart = getCurrentCycleStartDate();
    var lastProcessed = localStorage.getItem('la_last_processed_cycle_start') || '';
    if(lastProcessed >= cycleStart) return;
    localStorage.setItem('la_last_processed_cycle_start', cycleStart);
    performPaycheckCycleReset(lastProcessed || PAYCHECK_BASE_DATE, addDaysISO(cycleStart, -1));
  }

  function getCashOnHand(){ return loadJSON('la_cash_on_hand', 0) || 0; }

  function openCashBalanceModal(){
    document.getElementById('cash-balance-input').value = getCashOnHand() || '';
    openModal('cash-balance-modal');
  }
  function saveCashBalance(){
    var value = document.getElementById('cash-balance-input').value;
    saveJSON('la_cash_on_hand', parseFloat(value) || 0);
    closeModal('cash-balance-modal');
    renderCurrentNet();
  }

  function addOneCalendarMonth(d){
    var next = new Date(d);
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  /* Sum of expense-type (amount < 0) Spending Log entries dated within
     the CURRENT paycheck cycle (>= cycle start) and already passed
     (<= today) — the "Sum of Spending Log events that have already
     passed in the current paycheck cycle" that both Current Net and
     Projected Net subtract from Cash on Hand. Income-type entries
     (manual deposits, logged paychecks) are excluded here since they
     flow into Cash on Hand directly via Paycheck Cycle Reset's
     re-anchor and manual Cash Balance edits, not through this sum. */
  function getPassedCycleSpendingTotal(){
    var today = getAdjustedDate();
    var cycleStart = getCurrentCycleStartDate();
    return getSpendingLog()
      .filter(function(e){ return e.amount < 0 && e.date >= cycleStart && e.date <= today; })
      .reduce(function(sum, e){ return sum + Math.abs(e.amount); }, 0);
  }

  /* Current Net = Cash on Hand (re-anchored each Paycheck Reset) minus
     this cycle's passed spending so far. Re-anchoring happens in
     performPaycheckCycleReset, not here — this is a pure read. */
  function getCurrentNetValue(){
    var cash = getCashOnHand();
    var passedSpending = getPassedCycleSpendingTotal();
    return { cash: cash, passedSpending: passedSpending, currentNet: cash - passedSpending };
  }

  function renderCurrentNet(){
    var parts = getCurrentNetValue();

    document.getElementById('fin-current-net-formula').textContent = formatCurrency(parts.cash) + ' − ' + formatCurrency(parts.passedSpending) + ' =';
    var el = document.getElementById('fin-current-net-value');
    el.innerHTML = formatCurrency(parts.currentNet) + (parts.currentNet < 0 ? ' <span class="fin-shortfall-label">⚠</span>' : '');
    el.classList.toggle('positive', parts.currentNet >= 0);
    el.classList.toggle('negative', parts.currentNet < 0);

    renderProjectedCard();
  }

  /* ---- Auto-log recurring payments into the Spending Log once their
     due date passes (tracked per-item via lastDeductedDate so each
     occurrence is only ever logged once). Cash on Hand is NOT touched
     here — Current Net subtracts passed-in-cycle Spending Log entries
     from it live, so mutating cash directly here would double-count
     the deduction. Cash on Hand only ever changes via manual edits
     (Cash Balance modal) and Paycheck Cycle Reset's re-anchor. ---- */
  function processRecurringDeductions(){
    var list = getRecurring();
    var today = new Date(getAdjustedDate() + 'T00:00:00');
    var log = getSpendingLog();
    var listChanged = false;
    var logChanged = false;

    list.forEach(function(r){
      if(!r.lastDeductedDate){ r.lastDeductedDate = r.billingDate; listChanged = true; }
      var occ = new Date(r.lastDeductedDate + 'T00:00:00');
      var guard = 0;
      while(guard++ < 500){
        var next = advanceBillingDate(occ, r.frequency);
        if(next > today) break;
        log.push({ id: uid(), amount: -Math.abs(r.amount), category: 'Other', note: r.name, date: dateToISO(next) });
        logChanged = true;
        occ = next;
        r.lastDeductedDate = dateToISO(occ);
        listChanged = true;
      }
    });

    if(listChanged) saveRecurring(list);
    if(logChanged){
      saveSpendingLog(log);
      renderCurrentNet();
    }
  }

  function renderBudgetCard(){
    renderPaycheckInputs();
    var income = getMonthlyIncome();
    document.getElementById('monthly-income-row').textContent = 'Monthly income: ' + formatCurrency(income);

    var recurring = getRecurring();
    var total = recurring.reduce(function(sum, r){ return sum + monthlyEquivalent(r); }, 0);

    var wrap = document.getElementById('budget-recurring-list');
    if(!recurring.length){
      wrap.innerHTML = '<div class="fin-empty">No recurring payments yet</div>';
    } else {
      wrap.innerHTML = recurring.slice().sort(function(a,b){ return nextBillingDate(a) - nextBillingDate(b); }).map(function(r){
        return '<div class="fin-recurring-mini-row">' +
            '<span class="fin-recurring-mini-name">'+escapeHtml(r.name)+'</span>' +
            '<span class="fin-recurring-mini-amount mono">'+formatCurrency(-Math.abs(r.amount))+'</span>' +
          '</div>';
      }).join('');
    }
    document.getElementById('budget-recurring-total').textContent = 'Total: ' + formatCurrency(-total);

    var lastPaycheckAmt = parseFloat(getPaycheck().amount) || 0;
    var estProfit = lastPaycheckAmt * 2;
    document.getElementById('fin-breakdown-formula').textContent = formatCurrency(lastPaycheckAmt) + ' × 2 =';
    var freeEl = document.getElementById('fin-free-money');
    freeEl.textContent = formatCurrency(estProfit);
    freeEl.classList.toggle('positive', estProfit >= 0);
    freeEl.classList.toggle('negative', estProfit < 0);

    renderCurrentNet();
  }

  /* ============================================================
     Recurring Payments — la_recurring (shared by Budget + Recurring cards)
     Each item has a frequency (weekly/biweekly/monthly/quarterly/yearly)
     and a billingDate anchor; next occurrence is derived by advancing
     the anchor by one interval at a time until it reaches today.
  ============================================================ */
  var editingRecurringId = null;
  var RECURRING_FREQUENCY_LABELS = { weekly:'Weekly', biweekly:'Biweekly', monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly' };
  var RECURRING_MONTHLY_DIVISOR = { weekly: 12/52, biweekly: 12/26, monthly: 1, quarterly: 3, yearly: 12 };

  function getRecurring(){ return loadJSON('la_recurring', []); }
  function saveRecurring(list){ saveJSON('la_recurring', list); }

  function monthlyEquivalent(r){
    var amt = Math.abs(r.amount);
    var divisor = RECURRING_MONTHLY_DIVISOR[r.frequency];
    return divisor ? amt / divisor : amt;
  }

  function openRecurringModal(id){
    editingRecurringId = id || null;
    var item = id ? getRecurring().find(function(x){ return x.id === id; }) : null;
    document.getElementById('recurring-modal-title').textContent = id ? 'Edit Payment' : 'Add Recurring Payment';
    document.getElementById('recurring-name-input').value = item ? item.name : '';
    document.getElementById('recurring-amount-input').value = item ? item.amount : '';
    document.getElementById('recurring-frequency-input').value = item ? item.frequency : 'monthly';
    document.getElementById('recurring-date-input').value = item ? item.billingDate : dateToISO(addOneCalendarMonth(new Date(getAdjustedDate() + 'T00:00:00')));
    document.getElementById('recurring-delete-btn').style.display = id ? 'inline-flex' : 'none';
    openModal('recurring-modal');
  }
  function closeRecurringModal(){ closeModal('recurring-modal'); editingRecurringId = null; }

  function saveRecurringForm(){
    var name = document.getElementById('recurring-name-input').value.trim();
    var amount = parseFloat(document.getElementById('recurring-amount-input').value);
    var frequency = document.getElementById('recurring-frequency-input').value;
    var billingDate = document.getElementById('recurring-date-input').value;
    if(!name || isNaN(amount) || !billingDate) return;
    var list = getRecurring();
    if(editingRecurringId){
      var item = list.find(function(x){ return x.id === editingRecurringId; });
      if(item){ item.name = name; item.amount = amount; item.frequency = frequency; item.billingDate = billingDate; item.lastDeductedDate = billingDate; }
    } else {
      list.push({ id: uid(), name: name, amount: amount, frequency: frequency, billingDate: billingDate, lastDeductedDate: billingDate });
    }
    saveRecurring(list);
    closeRecurringModal();
    renderRecurringEverywhere();
  }

  function deleteRecurringItem(){
    if(!editingRecurringId) return;
    saveRecurring(getRecurring().filter(function(x){ return x.id !== editingRecurringId; }));
    closeRecurringModal();
    renderRecurringEverywhere();
  }

  function renderRecurringEverywhere(){
    renderBudgetCard();
    renderRecurringCard();
    renderProjectedCard();
  }

  function advanceBillingDate(d, frequency){
    var next = new Date(d);
    if(frequency === 'weekly') next.setDate(next.getDate() + 7);
    else if(frequency === 'biweekly') next.setDate(next.getDate() + 14);
    else if(frequency === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if(frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
    return next;
  }
  function nextBillingDate(r){
    var today = new Date(getAdjustedDate() + 'T00:00:00');
    var d = new Date(r.billingDate + 'T00:00:00');
    var guard = 0;
    while(d < today && guard++ < 500){
      d = advanceBillingDate(d, r.frequency);
    }
    return d;
  }
  /* Next occurrence NOT YET logged into the Spending Log — based on
     lastDeductedDate (the last occurrence processRecurringDeductions
     has already logged there), not the original billingDate anchor,
     so an occurrence already converted into a Spending Log entry is
     never ALSO counted as "upcoming" in Projected Net or the
     due-before-next-paycheck amber tint. Always strictly after today
     once processRecurringDeductions has run for the day. */
  function nextUnloggedBillingDate(r){
    var today = new Date(getAdjustedDate() + 'T00:00:00');
    var base = r.lastDeductedDate || r.billingDate;
    var d = advanceBillingDate(new Date(base + 'T00:00:00'), r.frequency);
    var guard = 0;
    while(d <= today && guard++ < 500){
      d = advanceBillingDate(d, r.frequency);
    }
    return d;
  }
  function isDueSoon(r){
    var today = new Date(getAdjustedDate() + 'T00:00:00');
    var next = nextBillingDate(r);
    var diffDays = Math.round((next - today) / 86400000);
    return diffDays >= 0 && diffDays <= 7;
  }
  function dateToISO(d){
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function renderRecurringCard(){
    var list = getRecurring().slice().sort(function(a,b){ return nextBillingDate(a) - nextBillingDate(b); });
    var wrap = document.getElementById('recurring-list');
    if(!list.length){
      wrap.innerHTML = '<div class="fin-empty">No recurring payments yet</div>';
      return;
    }
    var nextPaycheck = new Date(getNextPaycheckDate() + 'T00:00:00');
    wrap.innerHTML = list.map(function(r){
      var next = nextBillingDate(r);
      var dueSoon = isDueSoon(r);
      var upcomingPaycheck = nextUnloggedBillingDate(r) < nextPaycheck;
      var freqLabel = RECURRING_FREQUENCY_LABELS[r.frequency] || 'Monthly';
      var classes = 'fin-recurring-row' + (dueSoon ? ' due-soon' : '') + (upcomingPaycheck ? ' upcoming-paycheck-item' : '');
      return '<div class="'+classes+'" onclick="openRecurringModal(\''+r.id+'\')">' +
          '<span class="fin-recurring-name">'+escapeHtml(r.name)+'</span>' +
          '<span class="fin-recurring-day mono">'+freqLabel+' · '+formatDateHuman(dateToISO(next))+'</span>' +
          '<span class="fin-recurring-amount mono">'+formatCurrency(-Math.abs(r.amount))+'</span>' +
        '</div>';
    }).join('');
  }

  /* ============================================================
     Projected — isolated projection card. NEVER reads or writes
     la_cash_on_hand except read-only for display; hours/earnings
     tracking here never mutates the actual balance.
  ============================================================ */
  /* Planned expenses window runs from today up to (but not including)
     the next paycheck date — feeds Current Net / Projected Net /
     Hours Needed on the Monthly Budget card. Items due exactly ON the
     next paycheck date belong to the following cycle, not this one,
     so the boundary is a strict `<`, not inclusive. */
  function getPlannedExpensesBoundaryDate(){
    return new Date(getNextPaycheckDate() + 'T00:00:00');
  }

  function getEstimatedFullPaycheck(){
    var history = loadJSON('la_payday_history', []);
    if(history.length){
      var last3 = history.slice(-3);
      return last3.reduce(function(sum, h){ return sum + h.total; }, 0) / last3.length;
    }
    var EXPECTED_HOURS_PER_JOB = 20; // assumed full pay-period hours per job until real payout history exists
    return getJobs().reduce(function(sum, j){ return sum + jobAfterTaxRate(parseFloat(j.hourlyRate) || 0) * EXPECTED_HOURS_PER_JOB; }, 0);
  }

  /* Uses nextUnloggedBillingDate (not nextBillingDate) so an occurrence
     already converted into a Spending Log entry by
     processRecurringDeductions is never also counted here as
     "upcoming" — this is what requirement D calls "Upcoming Recurring
     Payments... that have NOT YET logged". */
  function getRecurringItemsWithinBoundary(boundary){
    var items = [];
    getRecurring().forEach(function(r){
      var occ = nextUnloggedBillingDate(r);
      var guard = 0;
      while(occ < boundary && guard++ < 500){
        items.push({ name: r.name, amount: Math.abs(r.amount) });
        occ = advanceBillingDate(occ, r.frequency);
      }
    });
    return items;
  }

  /* Paycheck-cycle window (see getPlannedExpensesBoundaryDate) — feeds
     getPlannedExpenses(), which drives the Monthly Budget card's
     Current Net / Projected Net / Hours Needed. */
  function getPlannedRecurringItems(){
    return getRecurringItemsWithinBoundary(getPlannedExpensesBoundaryDate());
  }

  /* Today up to (not including) the next paycheck date — feeds only
     the Spending Log card's Planned Expenses Recurring section (a
     shorter, single-cycle view distinct from the Budget card's window
     above, which is the same boundary here since both are scoped to
     "this paycheck cycle"). */
  function getSpendingLogRecurringItems(){
    return getRecurringItemsWithinBoundary(getPlannedExpensesBoundaryDate());
  }

  /* boundaryISO, if given, additionally excludes entries dated on or
     after it (strict `<`, matching "due BEFORE next paycheck") — used
     to scope Current Net / Projected Net to the current cycle. The
     Spending Log card's own "Planned" list calls this with no
     boundary, since it intentionally shows all future entries. */
  function getPlannedFutureSpendingItems(boundaryISO){
    var today = getAdjustedDate();
    return getSpendingLog().filter(function(e){ return e.date > today && e.amount < 0 && (!boundaryISO || e.date < boundaryISO); })
      .sort(function(a,b){ return a.date.localeCompare(b.date); })
      .map(function(e){ return { id: e.id, name: e.note || e.category, amount: Math.abs(e.amount), date: e.date }; });
  }

  /* Projected Net window: today up to (not including) the next
     paycheck date, for both recurring bills not yet logged and
     one-off planned spending. */
  function getPlannedExpenses(){
    return getPlannedRecurringItems().concat(getPlannedFutureSpendingItems(getNextPaycheckDate()));
  }

  function renderProjectedCard(){
    var earned = getTotalEarnedThisPeriod();
    var estimate = getEstimatedFullPaycheck();
    var pct = estimate > 0 ? Math.min(100, (earned / estimate) * 100) : 0;

    document.getElementById('projected-earned-value').textContent = formatCurrency(earned);
    document.getElementById('projected-earned-estimate').textContent = 'of est. ' + formatCurrency(estimate) + ' paycheck';
    document.getElementById('projected-earned-fill').style.width = pct + '%';

    var jobs = getJobs();
    PROJECTED_JOB_LABS.forEach(function(lab, i){
      document.getElementById('projected-hours-name-' + i).textContent = jobs[i].name || PROJECTED_JOB_DEFAULT_NAMES[i];
      var hoursVal = getLabHours(lab);
      document.getElementById('projected-hours-value-' + i).textContent = hoursVal.toFixed(1) + ' hrs';
      var hoursInput = document.getElementById('projected-hours-input-' + i);
      if(hoursInput) hoursInput.value = hoursVal.toFixed(1);
    });

    var planned = getPlannedExpenses();
    var plannedTotal = planned.reduce(function(sum, i){ return sum + i.amount; }, 0);
    var passedSpending = getPassedCycleSpendingTotal();

    var cash = getCashOnHand();
    var projectedCashAfterEarnings = cash + earned;
    document.getElementById('projected-net-formula').textContent = formatCurrency(cash) + ' + ' + formatCurrency(earned) + ' =';
    var el = document.getElementById('projected-net-value');
    el.innerHTML = formatCurrency(projectedCashAfterEarnings) + (projectedCashAfterEarnings < 0 ? ' <span class="fin-shortfall-label">⚠</span>' : '');
    el.classList.toggle('positive', projectedCashAfterEarnings >= 0);
    el.classList.toggle('negative', projectedCashAfterEarnings < 0);

    renderPlannedExpensesCard();
    renderBudgetProjectedNet(earned, plannedTotal, passedSpending);
    renderNextPaydayNote();
  }

  /* ---- Planned Expenses — Spending Log card's bottom half, split into
     Recurring (due today through next payday, inclusive — see
     getSpendingLogRecurringItems) and Planned (future-dated spending
     log entries) subsections. Read-only, no writes. ---- */
  function renderPlannedExpensesCard(){
    var recurringItems = getSpendingLogRecurringItems();
    var recurringWrap = document.getElementById('spending-planned-recurring-list');
    recurringWrap.innerHTML = recurringItems.length
      ? recurringItems.map(function(i){
          return '<div class="fin-planned-expenses-row">' +
              '<span class="fin-planned-expenses-name">'+escapeHtml(i.name)+'</span>' +
              '<span class="fin-planned-expenses-amount mono">'+formatCurrency(-i.amount)+'</span>' +
            '</div>';
        }).join('')
      : '<div class="fin-empty">No recurring payments due</div>';

    var futureItems = getPlannedFutureSpendingItems();
    var futureWrap = document.getElementById('spending-planned-future-list');
    futureWrap.innerHTML = futureItems.length
      ? futureItems.map(function(i){
          return '<div class="fin-planned-expenses-row fin-planned-expenses-row-clickable" onclick="openSpendingModal(\''+i.id+'\')">' +
              '<div class="fin-planned-expenses-name-date">' +
                '<span class="fin-planned-expenses-name">'+escapeHtml(i.name)+'</span>' +
                '<span class="fin-planned-expenses-date mono">'+formatDateHuman(i.date)+'</span>' +
              '</div>' +
              '<span class="fin-planned-expenses-amount mono">'+formatCurrency(-i.amount)+'</span>' +
            '</div>';
        }).join('')
      : '<div class="fin-empty">No planned entries</div>';

    var recurringTotal = recurringItems.reduce(function(sum, i){ return sum + i.amount; }, 0);
    var futureTotal = futureItems.reduce(function(sum, i){ return sum + i.amount; }, 0);
    document.getElementById('spending-planned-expenses-total').textContent = formatCurrency(-(recurringTotal + futureTotal));
  }

  /* ---- Monthly Budget card's Projected Net column, per spec:
     Updated Balance − Passed Spending Log entries (this cycle) −
     Upcoming Recurring (not yet logged) − Planned Payments (both due
     before next paycheck, combined here as plannedTotal) + Post-tax
     Research Earnings so far. Starts from the exact same cash/
     passedSpending base as Current Net, so the two never disagree on
     "what's already happened this cycle" — Projected Net just also
     looks ahead to what's still coming. ---- */
  function renderBudgetProjectedNet(earned, plannedTotal, passedSpending){
    var cash = getCashOnHand();
    var projectedNet = cash - passedSpending - plannedTotal + earned;
    document.getElementById('fin-budget-projected-formula').textContent =
      formatCurrency(cash) + ' − ' + formatCurrency(passedSpending) + ' − ' + formatCurrency(plannedTotal) + ' + ' + formatCurrency(earned) + ' =';
    var el = document.getElementById('fin-budget-projected-value');
    el.innerHTML = formatCurrency(projectedNet) + (projectedNet < 0 ? ' <span class="fin-shortfall-label">⚠</span>' : '');
    el.classList.toggle('positive', projectedNet >= 0);
    el.classList.toggle('negative', projectedNet < 0);

    renderHoursNeeded(plannedTotal + passedSpending, cash);
  }

  /* ---- Monthly Budget card's Hours Needed column: how many hours each
     lab must work (in parallel, both labs contributing simultaneously) to
     bring Projected Net to exactly $0. Uses the exact same plannedTotal
     (and raw cash) as Projected Net, not Current Net, so working the
     displayed hours actually zeroes out Projected Net. ---- */
  function renderHoursNeeded(plannedTotal, cash){
    var formulaEl = document.getElementById('fin-hours-needed-formula');
    var el = document.getElementById('fin-hours-needed-value');
    el.classList.remove('positive', 'negative', 'amber');

    var shortfall = plannedTotal - cash;
    if(shortfall <= 0){
      formulaEl.textContent = '';
      el.textContent = 'On track ✓';
      el.classList.add('positive');
      return;
    }

    var jobs = getJobs();
    var combinedRate = jobAfterTaxRate(parseFloat(jobs[0].hourlyRate) || 0) + jobAfterTaxRate(parseFloat(jobs[1].hourlyRate) || 0);
    if(combinedRate <= 0){
      formulaEl.textContent = '';
      el.textContent = 'Set hourly rates';
      return;
    }

    var hoursEach = shortfall / combinedRate;
    formulaEl.textContent = formatCurrency(shortfall) + ' ÷ ' + formatCurrency(combinedRate) + ' =';
    el.textContent = hoursEach.toFixed(1) + ' hrs each';
    el.classList.add('amber');
  }

  /* ============================================================
     Savings — la_savings_monthly / la_savings_rate / la_savings_total
     Current Total auto-accrues: for each calendar month elapsed since
     la_savings_last_accrual, that month's interest (annual rate ÷ 12,
     applied to the balance already on hand) is added on top of that
     month's deposit. Total stays directly editable to true it up
     against a real account; editing it resets the accrual anchor to
     today so past months aren't re-applied.
  ============================================================ */
  function getSavingsMonthly(){ return loadJSON('la_savings_monthly', 0) || 0; }
  function getSavingsRate(){ return loadJSON('la_savings_rate', 0) || 0; }
  function getSavingsTotal(){ return loadJSON('la_savings_total', 0) || 0; }

  function saveSavingsSettings(){
    var monthly = parseFloat(document.getElementById('savings-monthly-input').value);
    var rate = parseFloat(document.getElementById('savings-rate-input').value);
    saveJSON('la_savings_monthly', isNaN(monthly) ? 0 : monthly);
    saveJSON('la_savings_rate', isNaN(rate) ? 0 : rate);
    renderSavingsSection();
  }

  function saveSavingsTotalOverride(value){
    var total = parseFloat(value);
    saveJSON('la_savings_total', isNaN(total) ? 0 : total);
    saveJSON('la_savings_last_accrual', getAdjustedDate());
    renderSavingsSection();
  }

  function editSavingsTotal(){
    var input = document.getElementById('savings-total-input');
    var staticEl = document.getElementById('savings-total-static');
    staticEl.style.display = 'none';
    input.style.display = '';
    input.value = getSavingsTotal() ? Math.round(getSavingsTotal() * 100) / 100 : '';
    input.focus();
    input.select();
  }

  function renderSavingsTotalMode(){
    var input = document.getElementById('savings-total-input');
    var staticEl = document.getElementById('savings-total-static');
    input.style.display = 'none';
    staticEl.style.display = 'block';
  }

  function accrueSavings(){
    var lastAccrual = localStorage.getItem('la_savings_last_accrual');
    var today = getAdjustedDate();
    if(!lastAccrual){
      localStorage.setItem('la_savings_last_accrual', today);
      return;
    }
    var cursor = new Date(lastAccrual + 'T00:00:00');
    var todayDate = new Date(today + 'T00:00:00');
    var monthly = getSavingsMonthly();
    var monthlyRate = (getSavingsRate() / 100) / 12;
    var total = getSavingsTotal();
    var changed = false;
    var guard = 0;
    while(guard++ < 1200){
      var next = addOneCalendarMonth(cursor);
      if(next > todayDate) break;
      total = total + (total * monthlyRate) + monthly;
      cursor = next;
      changed = true;
    }
    if(changed){
      saveJSON('la_savings_total', total);
      localStorage.setItem('la_savings_last_accrual', dateToISO(cursor));
    }
  }

  function renderSavingsSection(){
    var monthly = getSavingsMonthly();
    var rate = getSavingsRate();
    var total = getSavingsTotal();
    document.getElementById('savings-monthly-input').value = monthly || '';
    document.getElementById('savings-rate-input').value = rate || '';
    var totalInput = document.getElementById('savings-total-input');
    var staticEl = document.getElementById('savings-total-static');
    totalInput.value = total ? Math.round(total * 100) / 100 : '';
    staticEl.textContent = total ? formatCurrency(total) : 'e.g. 5000';
    staticEl.style.color = total ? 'var(--ink)' : 'var(--ink-faint)';
    staticEl.style.fontStyle = total ? 'normal' : 'italic';
    if(document.activeElement !== totalInput) renderSavingsTotalMode();
  }

  /* ============================================================
     Investments — la_investments (array-of-objects + modal CRUD,
     same pattern as Recurring Payments / la_recurring)
  ============================================================ */
  var editingInvestmentId = null;
  var INVESTMENT_FREQUENCY_LABELS = { 'one-time':'One-time', weekly:'Weekly', biweekly:'Biweekly', monthly:'Monthly' };

  function getInvestments(){ return loadJSON('la_investments', []); }
  function saveInvestments(list){ saveJSON('la_investments', list); }

  function openInvestmentModal(id){
    editingInvestmentId = id || null;
    var item = id ? getInvestments().find(function(x){ return x.id === id; }) : null;
    document.getElementById('investment-modal-title').textContent = id ? 'Edit Investment' : 'Add Investment';
    document.getElementById('investment-platform-input').value = item ? item.platform : '';
    document.getElementById('investment-asset-input').value = item ? item.asset : '';
    document.getElementById('investment-amount-input').value = item ? item.amount : '';
    document.getElementById('investment-frequency-input').value = item ? item.frequency : 'monthly';
    document.getElementById('investment-delete-btn').style.display = id ? 'inline-flex' : 'none';
    openModal('investment-modal');
  }
  function closeInvestmentModal(){ closeModal('investment-modal'); editingInvestmentId = null; }

  function saveInvestmentForm(){
    var platform = document.getElementById('investment-platform-input').value.trim();
    var asset = document.getElementById('investment-asset-input').value.trim();
    var amount = parseFloat(document.getElementById('investment-amount-input').value);
    var frequency = document.getElementById('investment-frequency-input').value;
    if(!asset || isNaN(amount)) return;
    var list = getInvestments();
    if(editingInvestmentId){
      var item = list.find(function(x){ return x.id === editingInvestmentId; });
      if(item){ item.platform = platform; item.asset = asset; item.amount = amount; item.frequency = frequency; }
    } else {
      list.push({ id: uid(), platform: platform, asset: asset, amount: amount, frequency: frequency });
    }
    saveInvestments(list);
    closeInvestmentModal();
    renderInvestmentsList();
  }

  function deleteInvestmentItem(){
    if(!editingInvestmentId) return;
    saveInvestments(getInvestments().filter(function(x){ return x.id !== editingInvestmentId; }));
    closeInvestmentModal();
    renderInvestmentsList();
  }

  function renderInvestmentsList(){
    var list = getInvestments();
    var wrap = document.getElementById('investments-list');
    if(!list.length){
      wrap.innerHTML = '<div class="fin-empty">No investments yet</div>';
      return;
    }
    wrap.innerHTML = list.map(function(item){
      var freqLabel = INVESTMENT_FREQUENCY_LABELS[item.frequency] || 'Monthly';
      var platformSub = item.platform ? ' <span class="fin-investment-platform-sub">— '+escapeHtml(item.platform)+'</span>' : '';
      return '<div class="fin-recurring-row" onclick="openInvestmentModal(\''+item.id+'\')">' +
          '<span class="fin-recurring-name">'+escapeHtml(item.asset)+platformSub+'</span>' +
          '<span class="fin-recurring-day mono">'+freqLabel+'</span>' +
          '<span class="fin-recurring-amount mono" style="color:#4ade80;">'+formatCurrency(Math.abs(item.amount))+'</span>' +
        '</div>';
    }).join('');
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
    if(e.key === 'la_spending_log'){ renderSpendingLog(); }
    else if(e.key === 'la_recurring'){ renderRecurringEverywhere(); }
    else if(e.key === 'la_paycheck'){ renderBudgetCard(); }
    else if(e.key === 'la_cash_on_hand'){ renderCurrentNet(); }
    else if(e.key === 'la_jobs'){ renderJobsCard(); renderProjectedCard(); }
    else if(e.key === 'la_kranker_hours' || e.key === 'la_ballard_hours'){ renderProjectedCard(); }
    else if(e.key === 'la_savings_monthly' || e.key === 'la_savings_rate' || e.key === 'la_savings_total'){ renderSavingsSection(); }
    else if(e.key === 'la_investments'){ renderInvestmentsList(); }
  }
  window.addEventListener('storage', handleStorageSync);
  window.addEventListener('state-change', function(e){ handleStorageSync({ key: e.detail.key }); });

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
    checkPaycheckCycleReset();
    processRecurringDeductions();
    renderSpendingLog();
    accrueSavings();
    renderSavingsSection();
    if(typeof renderMoodCard === 'function'){ renderMoodCard(); }
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
  renderSpendingLog();
  renderBudgetCard();
  renderRecurringCard();
  renderJobsCard();
  renderProjectedCard();
  accrueSavings();
  renderSavingsSection();
  renderInvestmentsList();
  loadWeather();
  initSpotifyWidget();
  initYoutubeWidget();
  updateSidebarDateTime();
  setInterval(updateSidebarDateTime, 1000);
  runClockTick();
  setInterval(runClockTick, 60000);
  /* ============================================================
     PIN Gate — Financial page
     Never caches auth: every load re-shows the gate. PIN and
     recovery answer are stored only as SHA-256 hashes.
  ============================================================ */
  var PIN_STORAGE_KEY = 'la_financial_pin';
  var PIN_RECOVERY_Q_KEY = 'la_financial_recovery_q';
  var PIN_RECOVERY_A_KEY = 'la_financial_recovery_a';
  var FINANCIAL_RETURN_KEY = 'la_financial_return';

  function getFinancialReturnUrl(){
    return sessionStorage.getItem(FINANCIAL_RETURN_KEY) || document.referrer || '../index.html';
  }

  function exitFinancial(){
    window.location.href = getFinancialReturnUrl();
  }

  async function sha256Hex(str){
    var enc = new TextEncoder().encode(str);
    var buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  }

  function sanitizePinInput(el){
    el.value = el.value.replace(/[^0-9]/g,'').slice(0,6);
  }

  function isValidPin(pin){
    return /^[0-9]{4,6}$/.test(pin);
  }

  function showPinScreen(id){
    ['pin-setup-screen','pin-verify-screen','pin-forgot-question-screen','pin-reset-screen'].forEach(function(sid){
      document.getElementById(sid).classList.toggle('active', sid === id);
    });
  }

  function shakePinCard(cardId){
    var card = document.getElementById(cardId);
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }

  function unlockFinancialPage(){
    document.body.classList.add('pin-unlocked');
    document.getElementById('pin-gate-overlay').style.display = 'none';
  }

  function initPinGate(){
    var stored = localStorage.getItem(PIN_STORAGE_KEY);
    showPinScreen(stored ? 'pin-verify-screen' : 'pin-setup-screen');
  }

  async function handleSetupPin(){
    var pin = document.getElementById('setup-pin-input').value.trim();
    var confirmPin = document.getElementById('setup-pin-confirm-input').value.trim();
    var question = document.getElementById('setup-recovery-question').value.trim();
    var answer = document.getElementById('setup-recovery-answer').value.trim();
    var errorEl = document.getElementById('setup-error');

    if(!isValidPin(pin)){
      errorEl.textContent = 'PIN must be 4-6 digits.';
      shakePinCard('pin-setup-screen');
      return;
    }
    if(pin !== confirmPin){
      errorEl.textContent = 'PINs do not match.';
      shakePinCard('pin-setup-screen');
      return;
    }
    if(!question || !answer){
      errorEl.textContent = 'Recovery question and answer are required.';
      shakePinCard('pin-setup-screen');
      return;
    }
    errorEl.textContent = '';
    var pinHash = await sha256Hex(pin);
    var answerHash = await sha256Hex(answer.toLowerCase());
    localStorage.setItem(PIN_STORAGE_KEY, pinHash);
    localStorage.setItem(PIN_RECOVERY_Q_KEY, question);
    localStorage.setItem(PIN_RECOVERY_A_KEY, answerHash);
    unlockFinancialPage();
  }

  async function handleVerifyPin(){
    var input = document.getElementById('verify-pin-input');
    var errorEl = document.getElementById('verify-error');
    var stored = localStorage.getItem(PIN_STORAGE_KEY);
    var hash = await sha256Hex(input.value.trim());
    if(hash === stored){
      errorEl.textContent = '';
      unlockFinancialPage();
    } else {
      errorEl.textContent = 'Incorrect PIN';
      shakePinCard('pin-verify-screen');
      input.value = '';
      input.focus();
    }
  }

  function openForgotPin(){
    document.getElementById('forgot-question-display').textContent = localStorage.getItem(PIN_RECOVERY_Q_KEY) || '';
    document.getElementById('forgot-answer-input').value = '';
    document.getElementById('forgot-error').textContent = '';
    showPinScreen('pin-forgot-question-screen');
  }

  function cancelForgotPin(){
    document.getElementById('verify-error').textContent = '';
    document.getElementById('verify-pin-input').value = '';
    showPinScreen('pin-verify-screen');
  }

  async function handleForgotAnswer(){
    var input = document.getElementById('forgot-answer-input');
    var errorEl = document.getElementById('forgot-error');
    var storedHash = localStorage.getItem(PIN_RECOVERY_A_KEY);
    var hash = await sha256Hex(input.value.trim().toLowerCase());
    if(hash === storedHash){
      errorEl.textContent = '';
      document.getElementById('reset-error').textContent = '';
      document.getElementById('reset-pin-input').value = '';
      document.getElementById('reset-pin-confirm-input').value = '';
      showPinScreen('pin-reset-screen');
    } else {
      errorEl.textContent = 'Incorrect answer';
      shakePinCard('pin-forgot-question-screen');
      input.value = '';
      input.focus();
    }
  }

  async function handleResetPin(){
    var pin = document.getElementById('reset-pin-input').value.trim();
    var confirmPin = document.getElementById('reset-pin-confirm-input').value.trim();
    var errorEl = document.getElementById('reset-error');

    if(!isValidPin(pin)){
      errorEl.textContent = 'PIN must be 4-6 digits.';
      shakePinCard('pin-reset-screen');
      return;
    }
    if(pin !== confirmPin){
      errorEl.textContent = 'PINs do not match.';
      shakePinCard('pin-reset-screen');
      return;
    }
    errorEl.textContent = '';
    var pinHash = await sha256Hex(pin);
    localStorage.setItem(PIN_STORAGE_KEY, pinHash);
    unlockFinancialPage();
  }

  initPinGate();
