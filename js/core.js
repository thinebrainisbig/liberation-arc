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

  window.loadJSON = loadJSON;
  window.saveJSON = saveJSON;
  window.uid = uid;
  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.isLateNightWindow = isLateNightWindow;
  window.getAdjustedDate = getAdjustedDate;
  window.notifyStateChange = notifyStateChange;
})();
