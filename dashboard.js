fetch('data.json')
  .then(response => {
    if (!response.ok) {
      throw new Error("Could not load data.json. Make sure the file exists and you are using Live Server.");
    }
    return response.json();
  })
  .then(data => {
    
    // Grab the raw flat data from your JSON
    const rawData = data["Questionnaire Analysis"];
    
    // Map your exact Excel column names to the keys the dashboard expects
    const ALL = rawData.map(row => ({
      row_id: row["Row_ID"],
      section: row["Section"],
      question: row["Question"],
      segment: row["Data_Segment"],
      domain: row["Domain"],
      insight: row["Insight"],
      recommendation: row["Recommendation"],
      rec_category: row["Recommendation_Category"],
      stakeholder: row["Stakeholder"],
      beneficiary: row["Beneficiary"],
      // Allow flagging items as disagreements based on multiple possible column names in your Excel file
      is_disagreement: row["sentiment_flag"] === "disagreement" || row["is_disagreement"] === "Yes" || row["is_disagreement"] === true || row["is_disagreement"] === "True"
    }));

    // Automatically build the nested STRUCT (Sections -> Questions -> Items)
    const STRUCT = [];
    ALL.forEach(item => {
      let sec = STRUCT.find(s => s.section === item.section);
      if (!sec) {
        sec = { section: item.section, questions: [] };
        STRUCT.push(sec);
      }
      let q = sec.questions.find(q => q.question === item.question);
      if (!q) {
        q = { question: item.question, items: [] };
        sec.questions.push(q);
      }
      q.items.push(item);
    });

    // Automatically build the Definitions (Glossary) from your JSON
    const DEFS = {};
    if (data["Definitions"]) {
      data["Definitions"].forEach(row => {
        if (!DEFS[row.Category]) DEFS[row.Category] = [];
        DEFS[row.Category].push({ item: row.Item, def: row.Definition });
      });
    }

    // ==========================================
    // DASHBOARD RENDERING LOGIC
    // ==========================================

    const PALETTE = ['#3E7C7F','#C98A2B','#B14B3F','#6B7FB0','#8A9A5B','#A66FA3',
                     '#4B8FA6','#D4A24C','#7C6A9C','#5E9E8B','#C77B5A','#557094'];

    function splitMulti(v){
      if(!v) return [];
      return v.split(',').map(s=>s.trim()).filter(Boolean);
    }

    function countBy(arr, fn){
      const m = new Map();
      arr.forEach(x=>{
        const vals = fn(x);
        (Array.isArray(vals)?vals:[vals]).forEach(v=>{
          if(!v) return;
          m.set(v,(m.get(v)||0)+1);
        });
      });
      return [...m.entries()].sort((a,b)=>b[1]-a[1]);
    }

    function colorFor(label, list){
      const idx = list.indexOf(label) % PALETTE.length;
      return PALETTE[idx];
    }

    // ---------- Stats ----------
    document.getElementById('statSegments').textContent = ALL.length;
    const qSet = new Set(ALL.map(x=>x.question));
    document.getElementById('statQuestions').textContent = qSet.size;
    const globalDomainCounts = countBy(ALL, x=>x.domain);
    const domainLabels = globalDomainCounts.map(d=>d[0]);
    document.getElementById('statDomains').textContent = domainLabels.length;

    // ---------- Compass (radial) chart rendering logic ----------
    function renderCompass(svgElementId, domainCounts, totalItems){
      const svg = document.getElementById(svgElementId);
      if(!svg || domainCounts.length === 0) return;
      const cx=180, cy=175, rOuter=150, rInner=34;
      let angle = -90;
      let svgHtml = '';
      const maxCount = domainCounts[0][1];
      
      domainCounts.forEach(([label,count])=>{
        const frac = count/totalItems;
        const sweep = frac*360;
        const r = rInner + (rOuter-rInner) * Math.min(1, count / maxCount);
        const a0 = angle * Math.PI/180;
        const a1 = (angle+sweep) * Math.PI/180;
        const x0 = cx + r*Math.cos(a0), y0 = cy + r*Math.sin(a0);
        const x1 = cx + r*Math.cos(a1), y1 = cy + r*Math.sin(a1);
        const ix0 = cx + rInner*Math.cos(a0), iy0 = cy + rInner*Math.sin(a0);
        const ix1 = cx + rInner*Math.cos(a1), iy1 = cy + rInner*Math.sin(a1);
        const large = sweep > 180 ? 1 : 0;
        const color = colorFor(label, domainLabels);
        const path = `M ${ix0} ${iy0} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0} Z`;
        svgHtml += `<path class="compass-seg" d="${path}" fill="${color}" opacity="0.88"><title>${label}: ${count} segments (${(frac*100).toFixed(1)}%)</title></path>`;
        angle += sweep;
      });
      svgHtml += `<circle cx="${cx}" cy="${cy}" r="${rInner-2}" fill="var(--paper-raised)" stroke="var(--line)" />`;
      svgHtml += `<text x="${cx}" y="${cy-4}" text-anchor="middle" font-family="Inter, sans-serif" font-weight="600" font-size="22" fill="var(--ink)">${totalItems}</text>`;
      svgHtml += `<text x="${cx}" y="${cy+16}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="var(--ink-soft)">SEGMENTS</text>`;
      svg.innerHTML = svgHtml;
    }

    // Draw the global compass immediately
    renderCompass('compassChart', globalDomainCounts, ALL.length);

    // ---------- Overview bars ----------
    function renderBars(containerId, counts, maxN){
      const el = document.getElementById(containerId);
      const max = Math.max(...counts.map(c=>c[1]));
      el.innerHTML = counts.slice(0,maxN).map(([label,count])=>{
        const pct = (count/max*100).toFixed(1);
        return `<div class="bar-row">
          <div class="lbl">${label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--teal)"></div></div>
          <div class="val">${count}</div>
        </div>`;
      }).join('');
    }
    const stakeCounts = countBy(ALL, x=>splitMulti(x.stakeholder));
    const benCounts = countBy(ALL, x=>splitMulti(x.beneficiary));
    renderBars('stakeBars', stakeCounts, 10);
    renderBars('benBars', benCounts, 8);

    // ---------- Question-by-question ----------
    const sectionTabsEl = document.getElementById('sectionTabs');
    const questionListEl = document.getElementById('questionList');
    let activeSection = 0;

    function renderSectionTabs(){
      sectionTabsEl.innerHTML = STRUCT.map((s,i)=>{
        const n = s.questions.reduce((sum,q)=>sum+q.items.length,0);
        return `<button class="section-tab ${i===activeSection?'active':''}" data-i="${i}">${s.section}<span class="count">${n}</span></button>`;
      }).join('');
      [...sectionTabsEl.children].forEach(btn=>{
        btn.addEventListener('click', ()=>{
          activeSection = parseInt(btn.dataset.i);
          renderSectionTabs();
          renderQuestions();
          renderSectionCompass(); // Update localized chart on tab click
        });
      });
    }

    function renderSectionCompass(){
        const sec = STRUCT[activeSection];
        let sectionItems = [];
        sec.questions.forEach(q => sectionItems = sectionItems.concat(q.items));
        const sectionDomainCounts = countBy(sectionItems, x=>x.domain);
        renderCompass('sectionCompassChart', sectionDomainCounts, sectionItems.length);
    }

    function escapeHtml(s){
      return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // Conditionally append the .disagreement class
    function insightCardHtml(it, showQref){
      const stakes = splitMulti(it.stakeholder);
      const bens = splitMulti(it.beneficiary);
      const disagreementClass = it.is_disagreement ? " disagreement" : "";
      
      return `<div class="icard${disagreementClass}">
        ${showQref ? `<span class="qref">${escapeHtml(it.section)} - Q: ${escapeHtml(it.question.slice(0,90))}${it.question.length>90?'...':''}</span>` : ''}
        <p class="quote">${escapeHtml(it.segment)}</p>
        <div class="tagrow">
          ${it.domain?`<span class="tag domain" style="background:${colorFor(it.domain, domainLabels)}; color: white;">${escapeHtml(it.domain)}</span>`:''}
          ${it.rec_category?`<span class="tag rec">${escapeHtml(it.rec_category)}</span>`:''}
          ${it.is_disagreement?`<span class="tag disagree">Contrasting View</span>`:''}
        </div>
        ${it.insight?`<div class="field"><b>Insight:</b> ${escapeHtml(it.insight)}</div>`:''}
        ${it.recommendation?`<div class="field"><b>Recommendation:</b> ${escapeHtml(it.recommendation)}</div>`:''}
        <div class="chiprow">
          ${stakes.map(s=>`<span class="chip stake">-> ${escapeHtml(s)}</span>`).join('')}
          ${bens.map(b=>`<span class="chip ben">for ${escapeHtml(b)}</span>`).join('')}
        </div>
        <div class="icard-foot"><span>Row ${escapeHtml(it.row_id)}</span><span>${escapeHtml(it.section)}</span></div>
      </div>`;
    }

    function renderQuestions(){
      const sec = STRUCT[activeSection];
      questionListEl.innerHTML = sec.questions.map((q,qi)=>{
        const items = q.items;
        const dcounts = countBy(items, x=>x.domain);
        const total = items.length;
        
        const segBar = dcounts.map(([label,count])=>{
          const pct=(count/total*100).toFixed(2);
          return `<div class="qdomain-seg" style="width:${pct}%;background:${colorFor(label,domainLabels)}" title="${label}: ${count}"></div>`;
        }).join('');
        const legend = dcounts.map(([label,count])=>
          `<span><span class="dot" style="background:${colorFor(label,domainLabels)}"></span>${label} (${count})</span>`
        ).join('');

        // Group items by Domain
        const groupedByDomain = items.reduce((acc, item) => {
            if (!acc[item.domain]) acc[item.domain] = [];
            acc[item.domain].push(item);
            return acc;
        }, {});

        // Build the grouped HTML blocks
        let groupedHtml = '';
        Object.keys(groupedByDomain).forEach(domain => {
            groupedHtml += `<div class="domain-group">
                <div class="domain-group-title" style="color: ${colorFor(domain, domainLabels)}">${domain}</div>
                <div class="cards-col">
                    ${groupedByDomain[domain].map(it => insightCardHtml(it, false)).join('')}
                </div>
            </div>`;
        });

        return `<div class="qcard" data-qi="${qi}">
          <div class="qhead">
            <div>
              <span class="qnum">Question ${qi+1} of ${sec.questions.length}</span>
              <div class="qtext">${escapeHtml(q.question)}</div>
            </div>
            <div class="qmeta">
              <span class="n">${total} responses</span>
              <span class="chevron">+</span>
            </div>
          </div>
          <div class="qbody">
            <div class="qdomain-bar">${segBar}</div>
            <div class="qdomain-legend">${legend}</div>
            ${groupedHtml}
          </div>
        </div>`;
      }).join('');

      [...questionListEl.querySelectorAll('.qhead')].forEach(head=>{
        head.addEventListener('click', ()=>{
          head.closest('.qcard').classList.toggle('open');
        });
      });
    }

    renderSectionTabs();
    renderQuestions();
    renderSectionCompass();

    // ---------- Explorer / filters ----------
    const filterState = { domain:new Set(), rec:new Set(), stake:new Set(), ben:new Set(), q:'' };

    function buildFilterChips(containerId, counts, stateKey){
      const el = document.getElementById(containerId);
      el.innerHTML = counts.map(([label,count])=>
        `<button class="fchip" data-val="${escapeHtml(label)}">${escapeHtml(label)} <span class="mono">${count}</span></button>`
      ).join('');
      [...el.children].forEach(chip=>{
        chip.addEventListener('click', ()=>{
          const v = chip.dataset.val;
          if(filterState[stateKey].has(v)) filterState[stateKey].delete(v);
          else filterState[stateKey].add(v);
          chip.classList.toggle('active');
          renderExplorer();
        });
      });
    }

    const recCounts = countBy(ALL, x=>x.rec_category);
    buildFilterChips('fDomain', globalDomainCounts, 'domain');
    buildFilterChips('fRec', recCounts, 'rec');
    buildFilterChips('fStake', stakeCounts, 'stake');
    buildFilterChips('fBen', benCounts, 'ben');

    document.getElementById('searchInput').addEventListener('input', (e)=>{
      filterState.q = e.target.value.toLowerCase();
      renderExplorer();
    });

    document.getElementById('resetBtn').addEventListener('click', ()=>{
      filterState.domain.clear(); filterState.rec.clear(); filterState.stake.clear(); filterState.ben.clear();
      filterState.q='';
      document.getElementById('searchInput').value='';
      document.querySelectorAll('.fchip.active').forEach(c=>c.classList.remove('active'));
      renderExplorer();
    });

    function passesFilter(it){
      if(filterState.domain.size && !filterState.domain.has(it.domain)) return false;
      if(filterState.rec.size && !filterState.rec.has(it.rec_category)) return false;
      if(filterState.stake.size){
        const s = splitMulti(it.stakeholder);
        if(!s.some(x=>filterState.stake.has(x))) return false;
      }
      if(filterState.ben.size){
        const b = splitMulti(it.beneficiary);
        if(!b.some(x=>filterState.ben.has(x))) return false;
      }
      if(filterState.q){
        const hay = (it.segment+' '+it.insight+' '+it.recommendation).toLowerCase();
        if(!hay.includes(filterState.q)) return false;
      }
      return true;
    }

    let explorerLimit = 30;
    function renderExplorer(){
      const filtered = ALL.filter(passesFilter);
      document.getElementById('resultCount').textContent = `${filtered.length} of ${ALL.length} segments match`;
      const listEl = document.getElementById('explorerList');
      const slice = filtered.slice(0, explorerLimit);
      listEl.innerHTML = slice.map(it=>insightCardHtml(it,true)).join('');
      if(filtered.length > explorerLimit){
        listEl.innerHTML += `<button class="show-more-btn" id="explorerMore">Load more (${filtered.length-explorerLimit} remaining)</button>`;
        document.getElementById('explorerMore').addEventListener('click', ()=>{
          explorerLimit += 30;
          renderExplorer();
        });
      }
    }
    document.getElementById('explorerList').addEventListener('scroll', function(){});
    renderExplorer();

    // ---------- Summary Document View ----------
    function renderSummary(){
      const summaryContainer = document.getElementById('summaryContent');
      if (!summaryContainer) return;

      let html = '';
      
      STRUCT.forEach(sec => {
        // Render Section Title
        html += `<h2 style="font-family: 'Inter', sans-serif; font-size: 24px; color: var(--teal); margin-top: 40px; margin-bottom: 8px; border-bottom: 2px solid var(--line); padding-bottom: 8px;">${escapeHtml(sec.section)}</h2>`;
        
        sec.questions.forEach(q => {
          // Render Question Title
          html += `<h3 style="font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 600; margin-top: 32px; margin-bottom: 16px; color: var(--ink);">${escapeHtml(q.question)}</h3>`;
          
          // Group items by domain for this specific question
          const groupedByDomain = q.items.reduce((acc, item) => {
            if (!acc[item.domain]) acc[item.domain] = [];
            // Collect just the text segment
            acc[item.domain].push(item.segment);
            return acc;
          }, {});

          // Sort domains alphabetically to keep the reading experience consistent
          Object.keys(groupedByDomain).sort().forEach(domain => {
            // Render Domain Subheading
            html += `<h4 style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: ${colorFor(domain, domainLabels)}; margin-top: 24px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(domain)}</h4>`;
            
            // Join all individual segments into a single flowing paragraph separated by spaces
            const paragraphText = groupedByDomain[domain].map(escapeHtml).join(' ');
            html += `<p style="font-family: 'Inter', sans-serif; font-size: 15px; color: var(--ink-soft); line-height: 1.6; margin-bottom: 16px;">${paragraphText}</p>`;
          });
        });
      });
      
      summaryContainer.innerHTML = html;
    }
    
    // Call the function to build the document on load
    renderSummary();

    // ---------- Glossary modal ----------
    const glossaryContent = document.getElementById('glossaryContent');
    glossaryContent.innerHTML = Object.entries(DEFS).map(([cat, items])=>{
      return `<div class="gloss-cat"><h5>${escapeHtml(cat)}</h5>${items.map(i=>
        `<div class="gloss-item"><b>${escapeHtml(i.item)}</b> - <span>${escapeHtml(i.def)}</span></div>`
      ).join('')}</div>`;
    }).join('');

    const modal = document.getElementById('glossaryModal');
    document.getElementById('glossaryBtn').addEventListener('click', ()=>modal.classList.add('show'));
    document.getElementById('modalClose').addEventListener('click', ()=>modal.classList.remove('show'));
    modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.classList.remove('show'); });

  })
  .catch(error => {
    console.error('Error fetching data:', error);
  });