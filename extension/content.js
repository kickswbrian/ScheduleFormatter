(function () {
  if (window.__nyuOrganizerActive) return;
  window.__nyuOrganizerActive = true;

  // Content script always runs in the top frame (all_frames: false in manifest)
  var D = document;

  // Toolbar button toggles panel
  try {
    chrome.runtime.onMessage.addListener(function(msg) {
      if (msg.action !== 'togglePanel') return;
      var p = D.getElementById('__nyu-panel');
      if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
    });
  } catch(e) {}

  // ── Helpers ───────────────────────────────────────────────────────────────
  var DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var DAY_MAP = {
    mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday',
    mo:'Monday',tu:'Tuesday',we:'Wednesday',th:'Thursday',fr:'Friday',sa:'Saturday',su:'Sunday'
  };

  function expandDays(str) {
    return str.split(/[,\s]+/).map(function(d) {
      return DAY_MAP[d.toLowerCase().slice(0,3)] || DAY_MAP[d.toLowerCase().slice(0,2)] || null;
    }).filter(Boolean);
  }

  function parseTime(str) {
    var m = str.trim().match(/^(\d{1,2})\.(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    var h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mn;
  }

  function fmt12(t) {
    if (t == null) return '';
    var h = Math.floor(t/60), m = t%60, ap = h>=12?'PM':'AM', h12=h%12||12;
    return h12+':'+(m<10?'0':'')+m+' '+ap;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Text gathering ────────────────────────────────────────────────────────
  function gatherText(doc) {
    var text = '';
    try { text += doc.body.innerText || ''; } catch(e) {}
    try {
      var frames = doc.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        try { text += '\n' + gatherText(frames[i].contentDocument); } catch(e) {}
      }
    } catch(e) {}
    return text;
  }

  // ── Parser ────────────────────────────────────────────────────────────────
  var SCHED_RE = /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\s+([\w,]+)\s+(\d{1,2}\.\d{2}\s*[AP]M)\s*-\s*(\d{1,2}\.\d{2}\s*[AP]M)\s+at\s+(.+?)(?:\s+with\s+(.+?))?(?:\s*(?:Notes?:|$))/i;

  function normalizeText(raw) {
    var lines = raw.split('\n'), out = [], i = 0;
    var schedStart = /^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/;
    while (i < lines.length) {
      var line = lines[i].trim();
      if (schedStart.test(line)) {
        var joined = line;
        while (i+1 < lines.length) {
          var next = lines[i+1].trim();
          if (!next || schedStart.test(next)) break;
          if (/^(Class#|Section|Class Status|Component|Notes|Visit|Select|Session):/.test(next)) break;
          if (/^[A-Z]{2,}-[A-Z]{2}\s+\d+/.test(next)) break;
          joined += ' ' + next; i++;
        }
        out.push(joined);
      } else { out.push(line); }
      i++;
    }
    return out.join('\n');
  }

  function parse(raw) {
    var text = normalizeText(raw);
    var lines = text.split('\n'), sections = [], cur = null, blk = {};
    function flush() {
      if (!blk.sched) return;
      var m = blk.sched.match(SCHED_RE);
      if (!m) { blk={}; return; }
      var days=expandDays(m[1]), s=parseTime(m[2]), e=parseTime(m[3]);
      if (days.length && s!=null)
        sections.push({ courseCode:blk.code||(cur&&cur.c)||'', section:blk.sec||'', classNum:blk.num||'', component:blk.comp||'', status:blk.stat||'', days:days, startMin:s, endMin:e, location:(m[4]||'').trim(), instructor:(m[5]||'').trim() });
      blk={};
    }
    for (var i=0; i<lines.length; i++) {
      var ln=lines[i].trim(); if (!ln) continue;
      if (/^\s*[A-Z]{2,}-[A-Z]{2}\s+\d+\s*\|\s*\d+\s*units/.test(ln)) { var cm=ln.match(/([A-Z]{2,}-[A-Z]{2}\s+\d+)/); if(cm){cur={c:cm[1]};flush();} }
      else if (/^[A-Z]{2,}-[A-Z]{2}\s+\d+/.test(ln)&&ln.indexOf('Class#')!==0) { if(!blk.code)blk.code=ln.split(/\s+/).slice(0,2).join(' '); }
      else if (/^Class#:\s*(\d+)/.test(ln)) { flush(); blk.num=ln.match(/^Class#:\s*(\d+)/)[1]; if(cur)blk.code=cur.c; }
      else if (/^Section:\s*(\S+)/.test(ln))     { blk.sec=ln.match(/^Section:\s*(\S+)/)[1]; }
      else if (/^Class Status:\s*(.+)/.test(ln))  { blk.stat=ln.match(/^Class Status:\s*(.+)/)[1].trim(); }
      else if (/^Component:\s*(.+)/.test(ln))     { blk.comp=ln.match(/^Component:\s*(.+)/)[1].trim(); }
      else if (SCHED_RE.test(ln))                 { blk.sched=ln; }
    }
    flush(); return sections;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  var COLORS = {
    lecture:    {b:'#57068c',bg:'#f3e8ff',t:'#57068c'},
    recitation: {b:'#0062cc',bg:'#dbeafe',t:'#1d4ed8'},
    lab:        {b:'#28a745',bg:'#dcfce7',t:'#166534'},
    seminar:    {b:'#fd7e14',bg:'#ffedd5',t:'#9a3412'},
    other:      {b:'#adb5bd',bg:'#e9ecef',t:'#6c757d'}
  };

  function compType(c) {
    if (!c) return 'other';
    var l=c.toLowerCase();
    return l.indexOf('lecture')>=0?'lecture':l.indexOf('recitation')>=0?'recitation':l.indexOf('lab')>=0?'lab':l.indexOf('seminar')>=0?'seminar':'other';
  }

  function statusInfo(s) {
    if (!s) return {bg:'#dcfce7',t:'#15803d',label:'Open'};
    var l=s.toLowerCase();
    if(l.indexOf('wait')>=0) return {bg:'#fef9c3',t:'#854d0e',label:'Wait'};
    if(l.indexOf('closed')>=0||l.indexOf('full')>=0) return {bg:'#fee2e2',t:'#b91c1c',label:'Closed'};
    return {bg:'#dcfce7',t:'#15803d',label:'Open'};
  }

  function timeOpts(val, mode) {
    var def=mode==='start'?0:1440, h='<option value="'+def+'"'+(val===def?' selected':'')+'>Any</option>';
    for(var t=360;t<=1440;t+=30){
      if(mode==='start'&&t===1440)continue;
      h+='<option value="'+t+'"'+(val===t?' selected':'')+'>'+fmt12(t)+'</option>';
    }
    return h;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var allSections = [];
  var activeInstructors = {};
  var lastFP = '';

  function fp(secs) { return secs.map(function(s){return s.classNum+':'+s.startMin;}).join('|'); }

  // ── Filter / render ───────────────────────────────────────────────────────
  function applyFilters() {
    var s0el=D.getElementById('nf-start'), e0el=D.getElementById('nf-end');
    if (!s0el) return;
    var s0=parseInt(s0el.value), e0=parseInt(e0el.value), keys=Object.keys(activeInstructors);
    var filtered=allSections.filter(function(s){
      return s.startMin>=s0&&s.endMin<=e0&&(keys.length===0||!s.instructor||activeInstructors[s.instructor]);
    });
    renderSections(filtered);
  }

  function renderSections(secs) {
    var el=D.getElementById('nf-results'); if(!el) return;
    if (!secs.length) {
      el.innerHTML='<p style="text-align:center;color:#6c757d;padding:20px;font-size:12px">'+(allSections.length?'No sections match filters.':'Scroll so schedule times are visible on the Albert page, then click <b>Scan</b>.')+'</p>';
      return;
    }
    var byDay={};
    secs.forEach(function(s){s.days.forEach(function(d){if(!byDay[d])byDay[d]=[];byDay[d].push(s);});});
    var html=secs.length!==allSections.length?'<p style="font-size:11px;color:#6c757d;margin-bottom:8px">Showing <b>'+secs.length+'</b> of '+allSections.length+'</p>':'';
    DAY_ORDER.forEach(function(day){
      if(!byDay[day])return;
      var sorted=byDay[day].slice().sort(function(a,b){return a.startMin-b.startMin;});
      html+='<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="background:#57068c;color:#fff;font-size:10px;font-weight:700;padding:2px 10px;border-radius:10px;text-transform:uppercase">'+day+'</span><div style="flex:1;height:1px;background:#e9ecef"></div></div><div style="display:flex;flex-direction:column;gap:4px">';
      sorted.forEach(function(s){
        var ct=compType(s.component),col=COLORS[ct],si=statusInfo(s.status);
        html+='<div style="background:#fff;border-radius:6px;padding:6px 8px;display:grid;grid-template-columns:68px 1fr auto;gap:0 7px;align-items:center;border-left:3px solid '+col.b+';box-shadow:0 1px 3px rgba(0,0,0,.07)">'
          +'<div style="text-align:right"><b style="font-size:12px;color:#343a40;display:block">'+fmt12(s.startMin)+'</b><span style="font-size:10px;color:#6c757d">'+fmt12(s.endMin)+'</span></div>'
          +'<div><div style="display:flex;align-items:baseline;gap:3px;flex-wrap:wrap;margin-bottom:1px">'
          +'<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:'+col.b+'">'+esc(s.courseCode)+'</span>'
          +'<span style="font-size:10px;color:#6c757d">&sect;'+esc(s.section)+'</span>'
          +'<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;text-transform:uppercase;background:'+col.bg+';color:'+col.t+'">'+esc(s.component||'?')+'</span>'
          +'</div>'+(s.instructor?'<div style="font-size:10px;color:#6c757d">'+esc(s.instructor)+'</div>':'')+'</div>'
          +'<div style="text-align:right"><span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;background:'+si.bg+';color:'+si.t+'">'+si.label+'</span>'
          +(s.classNum?'<div style="font-size:9px;color:#adb5bd;font-family:monospace">#'+esc(s.classNum)+'</div>':'')+'</div></div>';
      });
      html+='</div></div>';
    });
    el.innerHTML=html;
  }

  function updateStats() {
    var el=D.getElementById('nf-stats'); if(!el) return;
    var op=0,wl=0,cl=0,crs={};
    allSections.forEach(function(s){
      var l=s.status.toLowerCase();
      if(l.indexOf('wait')>=0)wl++;else if(l.indexOf('closed')>=0||l.indexOf('full')>=0)cl++;else op++;
      crs[s.courseCode]=1;
    });
    var nc=Object.keys(crs).length;
    el.innerHTML=allSections.length+' sections &bull; '+nc+' course'+(nc!==1?'s':'')+
      ' &bull; <span style="color:#86efac">'+op+' open</span>'+
      ' &bull; <span style="color:#fde68a">'+wl+' wait</span>'+
      ' &bull; <span style="color:#fca5a5">'+cl+' closed</span>';
  }

  function rebuildChips() {
    var el=D.getElementById('nf-chips'); if(!el) return;
    var seen={},instrs=[];
    allSections.forEach(function(s){if(s.instructor&&!seen[s.instructor]){seen[s.instructor]=true;instrs.push(s.instructor);}});
    instrs.sort();
    el.innerHTML=instrs.map(function(n){
      return '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;border:1.5px solid #e9ecef;background:#fff;color:#6c757d;cursor:pointer;margin:2px;display:inline-block" class="nf-chip" data-n="'+esc(n)+'">'+esc(n)+'</span>';
    }).join('');
    activeInstructors={};
  }

  // ── Scan / refresh ────────────────────────────────────────────────────────
  function scan(showSpinner) {
    var btn=D.getElementById('nf-scan');
    if(showSpinner&&btn){btn.textContent='…';btn.disabled=true;}
    var newSecs=parse(gatherText(D));
    var newFP=fp(newSecs);
    if(newFP!==lastFP){
      lastFP=newFP; allSections=newSecs;
      updateStats(); rebuildChips(); applyFilters();
    }
    if(showSpinner&&btn){btn.textContent='Scan';btn.disabled=false;}
  }

  // ── Build panel ───────────────────────────────────────────────────────────
  var panel = D.createElement('div');
  panel.id = '__nyu-panel';
  panel.style.cssText = 'position:fixed;bottom:16px;right:16px;width:370px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.4;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;';

  panel.innerHTML =
    '<div style="background:#57068c;color:#fff;padding:9px 11px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'
      +'<div style="min-width:0">'
        +'<div style="font-size:13px;font-weight:700">NYU Course Organizer</div>'
        +'<div id="nf-stats" style="font-size:10px;opacity:.8;margin-top:1px">Scanning…</div>'
      +'</div>'
      +'<div style="display:flex;gap:4px;flex-shrink:0">'
        +'<button id="nf-scan" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600">Scan</button>'
        +'<button id="nf-min" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px">&#9660;</button>'
        +'<button id="nf-x" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:13px;font-weight:700">&#215;</button>'
      +'</div>'
    +'</div>'
    +'<div id="nf-body" style="background:#f8f9fa;display:flex;flex-direction:column;max-height:68vh">'
      +'<div style="background:#fff;padding:7px 10px;display:flex;flex-wrap:wrap;gap:7px;align-items:center;border-bottom:1px solid #e9ecef;flex-shrink:0">'
        +'<div style="display:flex;align-items:center;gap:3px"><label style="font-size:9px;font-weight:700;color:#6c757d;text-transform:uppercase">From</label>'
          +'<select id="nf-start" style="border:1.5px solid #e9ecef;border-radius:5px;padding:3px 5px;font-size:11px">'+timeOpts(0,'start')+'</select></div>'
        +'<div style="display:flex;align-items:center;gap:3px"><label style="font-size:9px;font-weight:700;color:#6c757d;text-transform:uppercase">To</label>'
          +'<select id="nf-end" style="border:1.5px solid #e9ecef;border-radius:5px;padding:3px 5px;font-size:11px">'+timeOpts(1440,'end')+'</select></div>'
        +'<div id="nf-chips" style="display:flex;flex-wrap:wrap;gap:2px;flex:1"></div>'
        +'<button id="nf-reset" style="background:none;border:none;color:#adb5bd;cursor:pointer;font-size:10px;text-decoration:underline;padding:0">Reset</button>'
      +'</div>'
      +'<div id="nf-results" style="padding:10px 11px;overflow-y:auto;flex:1"></div>'
    +'</div>';

  D.body.appendChild(panel);

  // Wire listeners
  D.getElementById('nf-x').addEventListener('click', function(){ panel.style.display='none'; });
  D.getElementById('nf-scan').addEventListener('click', function(){ scan(true); });
  D.getElementById('nf-start').addEventListener('change', applyFilters);
  D.getElementById('nf-end').addEventListener('change', applyFilters);
  D.getElementById('nf-reset').addEventListener('click', function(){
    D.getElementById('nf-start').value=0; D.getElementById('nf-end').value=1440;
    activeInstructors={};
    D.querySelectorAll('.nf-chip').forEach(function(c){c.style.background='#fff';c.style.color='#6c757d';c.style.borderColor='#e9ecef';});
    applyFilters();
  });
  D.getElementById('nf-chips').addEventListener('click', function(e){
    if(e.target&&e.target.classList.contains('nf-chip')){
      var n=e.target.getAttribute('data-n');
      if(activeInstructors[n])delete activeInstructors[n];else activeInstructors[n]=true;
      D.querySelectorAll('.nf-chip').forEach(function(c){
        var a=activeInstructors[c.getAttribute('data-n')];
        c.style.background=a?'#57068c':'#fff'; c.style.color=a?'#fff':'#6c757d'; c.style.borderColor=a?'#57068c':'#e9ecef';
      });
      applyFilters();
    }
  });

  var minimized=false;
  D.getElementById('nf-min').addEventListener('click',function(){
    minimized=!minimized;
    D.getElementById('nf-body').style.display=minimized?'none':'';
    D.getElementById('nf-min').innerHTML=minimized?'&#9650;':'&#9660;';
  });

  D.addEventListener('keydown',function(e){ if(e.key==='Escape') panel.style.display='none'; });

  // Initial scan + poll every 2s
  scan(false);
  setInterval(function(){ scan(false); }, 2000);

})();
