/* ============================================================
   Core storage/sync/utility helpers — shared by every page
   (index.html, financial-subpage.html, screens/*.html).
   Byte-identical across all 5 pages before this extraction;
   verified via diff before moving here.
============================================================ */
(function(){
  'use strict';

  function loadJSON(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }
  function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  function escapeHtml(s){
    var div = document.createElement('div');
    div.textContent = s == null ? '' : s;
    return div.innerHTML;
  }
  function escapeAttr(s){
    return (s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  function isLateNightWindow(){
    var hour = new Date().getHours();
    return hour >= 0 && hour < 5;
  }
  function getAdjustedDate(){
    var d = new Date();
    if(isLateNightWindow()){ d.setDate(d.getDate() - 1); }
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function notifyStateChange(key){
    window.dispatchEvent(new CustomEvent('state-change', { detail: { key: key } }));
  }

  function syncData(triggerEl){
    var data = {};
    for(var i=0;i<localStorage.length;i++){
      var key = localStorage.key(i);
      if(key && key.indexOf('la_') === 0){
        data[key] = loadJSON(key, localStorage.getItem(key));
      }
    }
    var blob = new Blob([JSON.stringify(data)], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'liberation-arc-sync.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);

    if(!triggerEl) return;
    var icon = triggerEl.querySelector('.material-symbols-outlined');
    var tip = triggerEl.querySelector('.sync-btn-tooltip');
    var prevIcon = icon ? icon.textContent : null;
    var prevTip = tip ? tip.textContent : null;
    if(icon) icon.textContent = 'check';
    if(tip) tip.textContent = 'Synced!';
    triggerEl.classList.add('synced');
    setTimeout(function(){
      if(icon) icon.textContent = prevIcon;
      if(tip) tip.textContent = prevTip;
      triggerEl.classList.remove('synced');
    }, 1600);
  }

  function triggerImportData(){
    var input = document.getElementById('sync-import-input');
    if(input) input.click();
  }

  function handleImportFileSelected(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{
        parsed = JSON.parse(reader.result);
      }catch(err){
        alert('Import failed: the selected file is not valid JSON.');
        return;
      }
      var keys = Object.keys(parsed);
      var confirmed = confirm('Import ' + keys.length + ' key' + (keys.length === 1 ? '' : 's') + ' from this file? This will overwrite your current local data for any matching keys.');
      if(!confirmed){
        alert('Import cancelled.');
        return;
      }
      keys.forEach(function(key){
        var value = parsed[key];
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      });
      location.reload();
    };
    reader.onerror = function(){
      alert('Import failed: could not read the selected file.');
    };
    reader.readAsText(file);
  }

  window.loadJSON = loadJSON;
  window.saveJSON = saveJSON;
  window.uid = uid;
  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.isLateNightWindow = isLateNightWindow;
  window.getAdjustedDate = getAdjustedDate;
  window.notifyStateChange = notifyStateChange;
  window.syncData = syncData;
  window.triggerImportData = triggerImportData;
  window.handleImportFileSelected = handleImportFileSelected;
})();
