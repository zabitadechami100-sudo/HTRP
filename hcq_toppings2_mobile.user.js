// ==UserScript==
// @name         HCQ's Toppings 2 (Mobile)
// @namespace    herocore
// @version      1.0.0
// @description  Quest scanner + auto-sell — wersja mobile (Android/Kiwi)
// @match        https://herocore.quest/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.__hcqT2m) return;
    window.__hcqT2m = true;

    // =========================================================
    //  JĘZYKI
    // =========================================================

    const LANGS = {
        en: {
            title: "HCQ's Toppings 2",
            wait: 'Play a quest to load data...', waitChar: 'Waiting...',
            play: 'Play a quest in game', playSub: 'Scanner captures data automatically',
            quests: 'quests', stage: 'Zone', energy: 'E',
            instant: 'instant', perE: '/E', go: '→',
            xp: '📈 XP', coins: '💰 Coins', skp: '⭐ Skill pts', tkts: '🍩 Donuts',
            hierLabel: 'Priority — tap to reorder',
            autoSellLabel: 'Auto-sell items from quests',
            autoSellDesc: 'When a new item appears after a quest, sell it automatically.',
            autoSellOn: 'ON', autoSellOff: 'OFF',
            soldMsg: 'Sold item',
            tabQuests: '⚡ Quests', tabAuto: '🤖 Auto',
        },
        pl: {
            title: "HCQ's Toppings 2",
            wait: 'Zagraj misję żeby załadować...', waitChar: 'Czekam...',
            play: 'Zagraj misję w grze', playSub: 'Skaner przechwyci dane automatycznie',
            quests: 'misji', stage: 'Strefa', energy: 'E',
            instant: 'natychm.', perE: '/E', go: '→',
            xp: '📈 XP', coins: '💰 Monety', skp: '⭐ Pkt um.', tkts: '🍩 Oponki',
            hierLabel: 'Priorytety — dotknij żeby zmienić',
            autoSellLabel: 'Auto-sprzedaż itemów z misji',
            autoSellDesc: 'Gdy nowy item pojawi się po misji, zostanie automatycznie sprzedany.',
            autoSellOn: 'WŁ', autoSellOff: 'WYŁ',
            soldMsg: 'Sprzedano item',
            tabQuests: '⚡ Misje', tabAuto: '🤖 Auto',
        },
    };

    let lang = localStorage.getItem('hcqm_lang') || 'pl';
    const T = () => LANGS[lang] || LANGS.pl;

    // =========================================================
    //  SETTINGS
    // =========================================================

    const SKEY = 'hcqm_cfg';
    const DEF  = { hierarchy: ['xp', 'coins', 'skill_points', 'tickets'], autoSell: false };
    let   cfg  = (() => { try { return {...DEF,...JSON.parse(localStorage.getItem(SKEY)||'{}')}; } catch(_){ return {...DEF}; } })();
    const saveCfg = () => localStorage.setItem(SKEY, JSON.stringify(cfg));

    // =========================================================
    //  STATE
    // =========================================================

    const st = {
        stageQuests: {}, char: {}, lastUpdate: null,
        auth: null, uid: null, sid: null,
        knownBagItems: new Set(), bagInitialized: false,
    };
    const allQ = () => Object.values(st.stageQuests).flat();

    // =========================================================
    //  XHR INTERCEPT
    // =========================================================

    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    let prevPrem = null, prevXP = null, prevCoins = null;

    XMLHttpRequest.prototype.open = function(m, u) {
        this._u = u;
        return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
        if (this._u?.includes('request.php')) {
            const b = body;
            this.addEventListener('load', () => {
                try {
                    const p = new URLSearchParams(b);
                    const action = p.get('action');
                    if (p.get('auth'))            st.auth = p.get('auth');
                    if (p.get('user_id'))         st.uid  = p.get('user_id');
                    if (p.get('user_session_id')) st.sid  = p.get('user_session_id');
                    onResponse(action, JSON.parse(this.responseText));
                } catch(_) {}
            });
        }
        return _send.apply(this, arguments);
    };

    // =========================================================
    //  RESPONSE HANDLER
    // =========================================================

    function onResponse(action, data) {
        if (!data || data.error) return;
        const d = data.data || {};

        if (d.character) {
            const c = d.character;
            prevPrem = c.premium_currency ?? prevPrem;
            prevXP   = c.xp              ?? prevXP;
            prevCoins = c.game_currency   ?? prevCoins;
            st.char = {
                name:      c.name             || st.char.name      || '?',
                level:     c.level            || st.char.level     || 0,
                energy:    c.quest_energy     !== undefined ? c.quest_energy     : st.char.energy,
                maxEnergy: c.max_quest_energy !== undefined ? c.max_quest_energy : st.char.maxEnergy,
            };
        }

        if (d.inventory) handleInventory(d.inventory);

        if (d.quests && Array.isArray(d.quests) && d.quests.length > 0) {
            const byStage = {};
            d.quests.forEach(q => {
                const p = parseQ(q); if (!p) return;
                if (!byStage[p.stage]) byStage[p.stage] = [];
                byStage[p.stage].push(p);
            });
            Object.entries(byStage).forEach(([s, qs]) => { st.stageQuests[s] = qs; });
            st.lastUpdate = new Date().toLocaleTimeString();
            renderMain();
        }
    }

    // =========================================================
    //  INVENTORY / AUTO-SELL
    // =========================================================

    function getBagItemIds(inv) {
        const ids = new Set();
        for (let i = 1; i <= 18; i++) {
            const v = inv[`bag_item${i}_id`];
            if (v && v !== 0) ids.add(v);
        }
        return ids;
    }

    function handleInventory(inv) {
        const currentBag = getBagItemIds(inv);
        if (!st.bagInitialized) {
            st.knownBagItems = new Set(currentBag);
            st.bagInitialized = true;
            return;
        }
        const newIds = [...currentBag].filter(id => !st.knownBagItems.has(id));
        if (newIds.length > 0 && cfg.autoSell) {
            newIds.forEach(itemId => sellItem(itemId));
        }
        st.knownBagItems = new Set(currentBag);
    }

    function sellItem(itemId) {
        post({ action: 'sellInventoryItem', item_id: itemId }, r => {
            if (r && !r.error) toast(`${T().soldMsg} #${itemId}`);
        });
    }

    // =========================================================
    //  PARSE QUEST
    // =========================================================

    function parseQ(q) {
        const id = parseInt(q.id); if (!id) return null;
        let rwd = q.rewards || {};
        if (typeof rwd === 'string') { try { rwd = JSON.parse(rwd); } catch(_) { rwd = {}; } }
        const ec = Math.max(parseInt(q.energy_cost) || 1, 1);
        const xp = parseInt(rwd.xp)        || 0;
        const co = parseInt(rwd.coins)      || 0;
        const sk = parseInt(rwd.statPoints) || 0;
        const tk = parseInt(rwd.premium)    || 0;
        return {
            id, stage: parseInt(q.stage) || 0,
            identifier: q.identifier || '',
            energy_cost: ec, duration: parseInt(q.duration) || 0,
            xp, coins: co, skill_points: sk, tickets: tk,
            xp_per_e:    +(xp / ec).toFixed(1),
            coins_per_e: +(co / ec).toFixed(1),
            skp_per_e:   +(sk / ec).toFixed(3),
            tkts_per_e:  +(tk / ec).toFixed(3),
        };
    }

    // =========================================================
    //  SORT
    // =========================================================

    const PER = { xp:'xp_per_e', coins:'coins_per_e', skill_points:'skp_per_e', tickets:'tkts_per_e' };
    function sortedQ() {
        return [...allQ()].sort((a, b) => {
            for (const k of cfg.hierarchy) {
                const pk = PER[k];
                if (b[pk] !== a[pk]) return b[pk] - a[pk];
            }
            return 0;
        });
    }

    // =========================================================
    //  API
    // =========================================================

    function post(params, cb) {
        if (!st.auth) return;
        const x = new XMLHttpRequest();
        _open.call(x, 'POST', 'https://herocore.quest/request.php');
        x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        if (cb) x.onload = () => { try { cb(JSON.parse(x.responseText)); } catch(_) { cb(null); } };
        _send.call(x, new URLSearchParams({
            ...params,
            user_id: st.uid, user_session_id: st.sid, auth: st.auth,
            client_version: 'html5_252', build_number: '232',
            rct: '1', keep_active: 'true', device_id: 'web', device_type: 'web',
        }).toString());
    }

    function goToStage(stage) {
        post({ action: 'setCharacterStage', stage }, () => {
            post({ action: 'getGuildLog', init_request: 'false' }, r => {
                if (r && !r.error) toast(`✓ ${T().stage} ${stage}`);
            });
        });
    }

    // =========================================================
    //  KOLORY / STAŁE
    // =========================================================

    const C = {
        bg:'#0d1117', bg2:'#161b22', bg3:'#21262d', border:'#30363d',
        green:'#3fb950', blue:'#58a6ff', yellow:'#e3b341',
        fg:'#c9d1d9', fg2:'#8b949e',
    };
    const SC = ['#388bfd','#3fb950','#f78166','#d2a8ff','#ffa657',
                '#79c0ff','#56d364','#ff7b72','#e3b341','#a5d6ff'];
    const CAT = {
        xp:           { color:'#79c0ff', icon:'📈', label:() => T().xp },
        coins:        { color:'#e3b341', icon:'💰', label:() => T().coins },
        skill_points: { color:'#d2a8ff', icon:'⭐', label:() => T().skp },
        tickets:      { color:'#ffa657', icon:'🍩', label:() => T().tkts },
    };

    // =========================================================
    //  UTILS
    // =========================================================

    function toast(msg) {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
            zIndex:'2147483647', background:C.green, color:'#0d1117',
            padding:'10px 18px', borderRadius:'8px',
            fontFamily:'Consolas,monospace', fontSize:'13px',
            fontWeight:'700', boxShadow:'0 2px 10px #0009',
            transition:'opacity .3s', whiteSpace:'nowrap',
        });
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
    }

    function dur(sec) {
        if (!sec) return T().instant;
        const m = Math.floor(sec / 60), s = sec % 60;
        return m ? `${m}m ${s}s` : `${s}s`;
    }

    // =========================================================
    //  UI
    // =========================================================

    let panel = null, bodyEl = null, charEl = null, statusEl = null, hierEl = null;
    let panelOpen = false, currentTab = 'quests';
    let tabBtns = {};

    function buildUI() {
        document.getElementById('hcqm-fab')?.remove();
        document.getElementById('hcqm-panel')?.remove();
        document.getElementById('hcqm-style')?.remove();

        // ── Style ──
        const style = document.createElement('style');
        style.id = 'hcqm-style';
        style.textContent = `
            #hcqm-fab {
                position: fixed; top: 60px; left: 10px;
                z-index: 2147483647;
                width: 56px; height: 56px;
                background: #3fb950; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 24px; cursor: pointer; font-weight: bold;
                box-shadow: 0 3px 14px #0009;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
                user-select: none;
                border: 3px solid #2ea040;
                pointer-events: all;
            }
            #hcqm-fab.has-data::after {
                content: '';
                position: absolute; top: 2px; right: 2px;
                width: 10px; height: 10px;
                background: #58a6ff; border-radius: 50%;
                box-shadow: 0 0 6px #58a6ff99;
            }
            #hcqm-panel {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                z-index: 2147483646;
                background: #0d1117;
                border: none;
                border-radius: 0;
                display: none;
                flex-direction: column;
                font-family: Consolas,"Courier New",monospace;
                font-size: 13px;
                box-shadow: none;
                overflow: hidden;
            }
            #hcqm-panel.open { display: flex; }

            /* Header */
            #hcqm-hdr {
                background: #161b22;
                padding: 12px 14px;
                border-bottom: 1px solid #30363d;
                display: flex; align-items: center; gap: 8px;
                flex-shrink: 0;
                min-height: 52px;
            }
            #hcqm-close {
                width: 44px; height: 44px;
                background: #21262d; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 20px; color: #8b949e; cursor: pointer;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
                flex-shrink: 0; margin-left: auto;
            }

            /* Lang */
            #hcqm-langs { display: flex; gap: 4px; }
            .hcqm-lb {
                padding: 3px 7px; border-radius: 4px; cursor: pointer;
                font-size: 10px; font-weight: 700; user-select: none;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
            }

            /* Char bar */
            #hcqm-char {
                background: #161b22; padding: 7px 14px;
                border-bottom: 1px solid #30363d;
                display: flex; gap: 8px; align-items: center;
                color: #8b949e; font-size: 12px; flex-shrink: 0;
                flex-wrap: wrap; min-height: 34px;
            }

            /* Tabs */
            #hcqm-tabs {
                background: #161b22; display: flex;
                border-bottom: 1px solid #30363d; flex-shrink: 0;
            }
            .hcqm-tab {
                padding: 14px 18px; cursor: pointer; user-select: none;
                font-size: 13px; touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
                flex: 1; text-align: center; min-height: 48px;
                display: flex; align-items: center; justify-content: center;
            }

            /* Hier bar */
            #hcqm-hier {
                background: #161b22; padding: 8px 14px;
                border-bottom: 1px solid #30363d;
                display: flex; align-items: center; gap: 6px;
                flex-shrink: 0; flex-wrap: wrap;
            }
            .hcqm-hbtn {
                display: inline-flex; align-items: center; gap: 4px;
                padding: 8px 14px; border-radius: 20px; cursor: pointer;
                font-size: 13px; font-weight: 700; user-select: none;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
                min-height: 40px;
            }

            /* Body */
            #hcqm-body {
                overflow-y: scroll;
                -webkit-overflow-scrolling: touch;
                flex: 1;
                min-height: 0;
                padding: 10px;
                overscroll-behavior: contain;
            }

            /* Quest cards */
            .hcqm-card {
                background: #161b22; border: 1px solid #30363d;
                border-radius: 12px; padding: 12px 14px; margin-bottom: 8px;
            }
            .hcqm-card.top { background: #e3b34110; border-color: #e3b341; }
            .hcqm-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
            .hcqm-stage-badge { font-size: 10px; padding: 3px 10px; border-radius: 20px; font-weight: 700; white-space: nowrap; }
            .hcqm-ident { color: #8b949e; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .hcqm-primary { font-weight: 700; font-size: 15px; white-space: nowrap; }
            .hcqm-gobtn {
                background: #21262d; color: #58a6ff;
                border: 1px solid #30363d; border-radius: 8px;
                padding: 10px 16px; cursor: pointer; font-size: 13px;
                font-family: Consolas,monospace; white-space: nowrap;
                flex-shrink: 0; touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
                min-height: 44px; display: flex; align-items: center;
            }
            .hcqm-cats { display: flex; gap: 5px; margin-bottom: 10px; }
            .hcqm-cat {
                border-radius: 8px; padding: 6px 8px;
                text-align: center; flex: 1; min-width: 0;
            }
            .hcqm-cat-icon { font-size: 9px; color: #8b949e; margin-bottom: 2px; }
            .hcqm-cat-val { font-weight: 700; font-size: 14px; }
            .hcqm-cat-per { font-size: 10px; color: #3fb950; }
            .hcqm-meta { font-size: 11px; color: #8b949e; }

            /* Auto tab */
            .hcqm-toggle-row {
                background: #161b22; border: 1px solid #30363d;
                border-radius: 12px; padding: 16px 14px; margin-bottom: 10px;
                display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
            }
            .hcqm-toggle-label { color: #c9d1d9; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
            .hcqm-toggle-desc { color: #8b949e; font-size: 11px; line-height: 1.5; }
            .hcqm-toggle-btn {
                border-radius: 20px; padding: 12px 20px;
                cursor: pointer; font-size: 14px; font-weight: 700;
                white-space: nowrap; flex-shrink: 0; user-select: none;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
                min-height: 48px; display: flex; align-items: center;
            }

            /* Empty state */
            .hcqm-empty {
                color: #8b949e; text-align: center;
                padding: 50px 20px; line-height: 2.2;
            }

            /* Toast */
        `;
        (document.head || document.documentElement).appendChild(style);

        // ── FAB ──
        const fab = document.createElement('div');
        fab.id = 'hcqm-fab';
        fab.textContent = '⚡';
        fab.addEventListener('click', togglePanel);
        fab.addEventListener('touchend', function(e) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });
        (document.body || document.documentElement).appendChild(fab);

        // ── Panel ──
        panel = document.createElement('div');
        panel.id = 'hcqm-panel';

        panel.innerHTML = `
            <div id="hcqm-hdr">
                <span style="color:#3fb950;font-weight:700;font-size:14px">${T().title}</span>
                <span id="hcqm-status" style="color:#8b949e;font-size:11px;flex:1;padding-left:8px">${T().wait}</span>
                <div id="hcqm-langs">
                    <span class="hcqm-lb" data-l="pl">PL</span>
                    <span class="hcqm-lb" data-l="en">EN</span>
                </div>
                <div id="hcqm-close">✕</div>
            </div>
            <div id="hcqm-char">${T().waitChar}</div>
            <div id="hcqm-tabs">
                <div class="hcqm-tab" data-tab="quests">${T().tabQuests}</div>
                <div class="hcqm-tab" data-tab="auto">${T().tabAuto}</div>
            </div>
            <div id="hcqm-hier"></div>
            <div id="hcqm-body"></div>
        `;
        (document.body || document.documentElement).appendChild(panel);

        // refs
        bodyEl   = panel.querySelector('#hcqm-body');
        charEl   = panel.querySelector('#hcqm-char');
        statusEl = panel.querySelector('#hcqm-status');
        hierEl   = panel.querySelector('#hcqm-hier');

        // close
        panel.querySelector('#hcqm-close').addEventListener('click', e => {
            e.stopPropagation();
            panelOpen = false;
            panel.classList.remove('open');
        });

        // lang
        panel.querySelectorAll('.hcqm-lb').forEach(lb => {
            lb.addEventListener('click', () => switchLang(lb.dataset.l));
        });

        // tabs
        panel.querySelectorAll('.hcqm-tab').forEach(tb => {
            tabBtns[tb.dataset.tab] = tb;
            tb.addEventListener('click', () => switchTab(tb.dataset.tab));
        });

        // go buttons + hier buttons (delegacja)
        bodyEl.addEventListener('click', e => {
            const gb = e.target.closest('.hcqm-go');
            if (gb) { goToStage(parseInt(gb.dataset.stage)); return; }
            const hb = e.target.closest('.hcqm-hbtn');
            if (hb) shiftHier(hb.dataset.cat);
        });
        hierEl.addEventListener('click', e => {
            const hb = e.target.closest('.hcqm-hbtn');
            if (hb) shiftHier(hb.dataset.cat);
        });

        updateLangBtns();
        buildHierBar();
        switchTab('quests');
        renderEmpty();
    }

    // ── Panel toggle ─────────────────────────────────────────

    function togglePanel() {
        panelOpen = !panelOpen;
        panel.classList.toggle('open', panelOpen);
        if (panelOpen) renderMain();
    }

    // ── Lang ─────────────────────────────────────────────────

    function updateLangBtns() {
        panel.querySelectorAll('.hcqm-lb').forEach(lb => {
            const active = lb.dataset.l === lang;
            lb.style.background = active ? C.green  : C.bg3;
            lb.style.color      = active ? '#0d1117': C.fg2;
            lb.style.border     = `1px solid ${active ? C.green : C.border}`;
        });
    }

    function switchLang(l) {
        lang = l; localStorage.setItem('hcqm_lang', l);
        updateLangBtns();
        buildHierBar(); renderMain();
    }

    // ── Tabs ─────────────────────────────────────────────────

    function switchTab(tab) {
        currentTab = tab;
        Object.entries(tabBtns).forEach(([k, tb]) => {
            tb.style.color        = k === tab ? C.fg  : C.fg2;
            tb.style.borderBottom = k === tab ? `2px solid ${C.green}` : '2px solid transparent';
        });
        hierEl.style.display = tab === 'quests' ? 'flex' : 'none';
        renderBody();
    }

    // ── Hier bar ─────────────────────────────────────────────

    function buildHierBar() {
        if (!hierEl) return;
        hierEl.innerHTML = `<span style="color:${C.fg2};font-size:10px;white-space:nowrap">${T().hierLabel}:</span>`;
        cfg.hierarchy.forEach((cat, i) => {
            const info = CAT[cat];
            const btn = document.createElement('span');
            btn.className = 'hcqm-hbtn';
            btn.dataset.cat = cat;
            btn.style.cssText = `background:${info.color}22;color:${info.color};border:1px solid ${info.color}55;`;
            btn.innerHTML = `<span style="color:${C.fg2};font-size:10px">${i+1}</span> ${info.icon}`;
            hierEl.appendChild(btn);
            if (i < cfg.hierarchy.length - 1) {
                const sep = document.createElement('span');
                sep.textContent = '›';
                sep.style.cssText = `color:${C.fg2};font-size:13px`;
                hierEl.appendChild(sep);
            }
        });
    }

    function shiftHier(cat) {
        const h = cfg.hierarchy, i = h.indexOf(cat);
        if (i <= 0) { cfg.hierarchy = [...h.slice(1), h[0]]; }
        else { const n=[...h]; [n[i-1],n[i]]=[n[i],n[i-1]]; cfg.hierarchy=n; }
        saveCfg(); buildHierBar(); renderBody();
    }

    // =========================================================
    //  RENDER
    // =========================================================

    function renderMain() {
        renderChar(); renderStatus(); renderBody();
    }

    function renderChar() {
        if (!charEl || !st.char.name) return;
        const pct = Math.round((st.char.energy / Math.max(st.char.maxEnergy, 1)) * 100);
        charEl.innerHTML = `
            <span style="color:${C.blue};font-weight:700">${st.char.name}</span>
            <span style="background:${C.bg3};padding:3px 9px;border-radius:20px;color:${C.yellow}">Lvl ${st.char.level}</span>
            <span style="position:relative;background:${C.bg3};border-radius:20px;padding:3px 12px;overflow:hidden;min-width:140px">
                ⚡ ${st.char.energy}/${st.char.maxEnergy}
                <span style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${C.green}33;border-radius:20px"></span>
            </span>
            <span style="margin-left:auto;color:${C.fg2};font-size:11px">📋 ${allQ().length} ${T().quests}</span>`;
    }

    function renderStatus() {
        if (!statusEl) return;
        if (!allQ().length) { statusEl.textContent = T().wait; statusEl.style.color = C.fg2; return; }
        statusEl.textContent = `✓ ${allQ().length} ${T().quests} | ${st.lastUpdate}`;
        statusEl.style.color = C.green;
        document.getElementById('hcqm-fab')?.classList.add('has-data');
    }

    function renderBody() {
        if (!bodyEl) return;
        if (currentTab === 'quests') renderQuestList();
        else renderAutoTab();
    }

    function renderEmpty() {
        if (!bodyEl) return;
        bodyEl.innerHTML = `<div class="hcqm-empty">
            <div style="font-size:32px;margin-bottom:10px">⚡</div>
            <div style="color:${C.fg};font-size:14px">${T().play}</div>
            <div style="font-size:11px">${T().playSub}</div>
        </div>`;
    }

    // ── Quest list ────────────────────────────────────────────

    function renderQuestList() {
        const quests = sortedQ();
        if (!quests.length) { renderEmpty(); return; }

        const primary = cfg.hierarchy[0];
        const info = CAT[primary];
        const medals = {0:'🥇',1:'🥈',2:'🥉'};

        bodyEl.innerHTML = quests.map((q, i) => {
            const sc = SC[(q.stage - 1) % SC.length];
            const isTop = i === 0;
            const primaryVal = q[PER[primary]];

            const cats = cfg.hierarchy.map((cat, rank) => {
                const ci = CAT[cat];
                const raw = cat==='xp' ? q.xp : cat==='coins' ? q.coins : cat==='skill_points' ? q.skill_points : q.tickets;
                const perE = q[PER[cat]];
                const isFirst = rank === 0;
                return `<div class="hcqm-cat" style="background:${isFirst?ci.color+'18':C.bg3};border:1px solid ${isFirst?ci.color+'44':'transparent'}">
                    <div class="hcqm-cat-icon">${ci.icon} <span style="color:${C.fg2}">${rank+1}°</span></div>
                    <div class="hcqm-cat-val" style="color:${ci.color}">${raw > 999 ? raw.toLocaleString() : (raw || '–')}</div>
                    <div class="hcqm-cat-per">${perE}${T().perE}</div>
                </div>`;
            }).join('');

            const medal = medals[i] || `<span style="color:${C.fg2}">#${i+1}</span>`;

            return `<div class="hcqm-card ${isTop?'top':''}">
                <div class="hcqm-card-top">
                    <span style="font-size:${i<3?'18':'13'}px;min-width:20px">${medal}</span>
                    <span class="hcqm-stage-badge" style="background:${sc}22;color:${sc};border:1px solid ${sc}44">${T().stage} ${q.stage}</span>
                    <span class="hcqm-ident">${q.identifier}</span>
                    <span class="hcqm-primary" style="color:${info.color}">${primaryVal}${T().perE}</span>
                    <button class="hcqm-go hcqm-gobtn" data-stage="${q.stage}">${T().go} ${q.stage}</button>
                </div>
                <div class="hcqm-cats">${cats}</div>
                <div class="hcqm-meta">⚡ ${q.energy_cost}${T().energy} &nbsp;|&nbsp; ⏱ ${dur(q.duration)}</div>
            </div>`;
        }).join('');
    }

    // ── Auto tab ─────────────────────────────────────────────

    function renderAutoTab() {
        bodyEl.innerHTML = `
            <div style="font-weight:700;color:${C.fg};font-size:14px;margin-bottom:14px">🤖 Auto</div>
            <div class="hcqm-toggle-row">
                <div style="flex:1">
                    <div class="hcqm-toggle-label">${T().autoSellLabel}</div>
                    <div class="hcqm-toggle-desc">${T().autoSellDesc}</div>
                </div>
                <div class="hcqm-toggle-btn" id="hcqm-sell-btn"
                    style="background:${cfg.autoSell?C.green:C.bg3};color:${cfg.autoSell?'#0d1117':C.fg2};border:1px solid ${cfg.autoSell?C.green:C.border}">
                    ${cfg.autoSell ? T().autoSellOn : T().autoSellOff}
                </div>
            </div>
        `;
        bodyEl.querySelector('#hcqm-sell-btn').addEventListener('click', () => {
            cfg.autoSell = !cfg.autoSell;
            saveCfg(); renderAutoTab();
        });
    }

    // =========================================================
    //  INIT
    // =========================================================

    function init() {
        buildUI();
        // Toast potwierdzający że skrypt działa — zniknie po 3s
        setTimeout(() => toast('⚡ HCQ Toppings załadowany!'), 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else if (document.readyState === 'interactive' || document.readyState === 'complete') {
        // Małe opóźnienie dla mobile — upewnij się że body istnieje
        setTimeout(init, 100);
    }

})();
