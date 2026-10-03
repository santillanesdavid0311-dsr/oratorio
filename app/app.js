/* Gastos del Oratorio — app móvil (PWA) con modo sin conexión */
(function () {
'use strict';
const C = window.CONFIG || {};
const DEMO = !C.API_URL;
const ENTIDADES = ['Oratorio', 'DJN'];

/* ---------- utilidades ---------- */
const $app = document.getElementById('app');
const $ov = document.getElementById('overlay');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const timeStr = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const monthKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = k => { const [y, m] = k.split('-'); return MESES[+m - 1].replace(/^./, c => c.toUpperCase()) + ' ' + y; };
const shiftMonth = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return monthKey(d); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));
const newFolio = () => 'F' + todayStr().replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
const fechaCorta = f => { const [y, m, d] = f.split('-'); return +d + ' ' + MESES[+m - 1].slice(0, 3) + ' ' + y; };
const horaCorta = h => (h || '').slice(0, 5);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } }
};

const CAT_DEF = {
  TipoIngreso: [{ v: 'Entrada ordinaria (oficina)', e: 'DJN' }, { v: 'Kermés', e: 'Oratorio' }],
  OrigenIngreso: ['Donativo', 'Colecta', 'Cuota o aportación', 'Venta de alimentos', 'Venta de boletos', 'Rifa o sorteo', 'Intención de misa', 'Apoyo de benefactor'],
  Metodo: ['Efectivo', 'Transferencia', 'Depósito', 'Cheque'],
  Actividad: ['Oficina', 'Kermés', 'Catequesis', 'Deportes', 'Fiesta patronal', 'Campamento', 'Mantenimiento'],
  Concepto: ['Alimentos y bebidas', 'Material y papelería', 'Servicios (luz, agua, internet)', 'Mantenimiento y reparaciones', 'Limpieza', 'Transporte', 'Pago a personal', 'Equipo y mobiliario']
};

/* ---------- estado ---------- */
const S = {
  screen: 'login', users: ls.get('o_users', []), sel: null, pin: '', msg: '',
  user: null, online: true, mes: monthKey(new Date()), movs: [], cargando: false,
  cat: ls.get('o_cat', CAT_DEF), W: null, detalle: null, ultimo: null, syncMsg: ''
};
let tokens = ls.get('o_tokens', {});
let syncing = false;

/* ---------- servidor (o modo demostración) ---------- */
async function api(action, payload, token) {
  if (DEMO) return mock(action, payload || {}, token);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(C.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify(Object.assign({ action, token }, payload || {})), signal: ctrl.signal
    });
    const j = await r.json();
    S.online = true;
    return j;
  } catch (e) {
    S.online = false;
    return { ok: false, code: 'red', error: 'Sin conexión' };
  } finally { clearTimeout(t); }
}

/* Servidor de mentiras para probar la app sin Google Sheets */
function mockDb() {
  let db = ls.get('mock_db', null);
  if (!db) {
    db = { users: [{ u: 'padre', nombre: 'Padre (Administrador)', rol: 'admin', pin: '1234', activo: true }, { u: 'maria', nombre: 'María (Oficina)', rol: 'capturista', pin: '1111', activo: true }], movs: [] };
    ls.set('mock_db', db);
  }
  return db;
}
async function mock(action, p, token) {
  await new Promise(r => setTimeout(r, 200));
  if (ls.get('o_sim_offline', false)) { S.online = false; return { ok: false, code: 'red', error: 'Sin conexión' }; }
  S.online = true;
  const db = mockDb(); const save = () => ls.set('mock_db', db);
  const me = token && token.indexOf('mock:') === 0 ? db.users.find(x => x.u === token.slice(5) && x.activo !== false) : null;
  if (!['usuarios', 'login'].includes(action) && !me) return { ok: false, code: 'auth', error: 'Sesión vencida' };
  const isAdmin = me && me.rol === 'admin';
  switch (action) {
    case 'usuarios': return { ok: true, data: db.users.filter(u => u.activo !== false).map(u => ({ u: u.u, nombre: u.nombre })) };
    case 'login': {
      const u = db.users.find(x => x.u === p.u && x.activo !== false);
      if (!u || u.pin !== p.pin) return { ok: false, code: 'pin', error: 'El PIN no es correcto' };
      return { ok: true, data: { token: 'mock:' + u.u, user: { u: u.u, nombre: u.nombre, rol: u.rol, debeCambiar: !!u.debeCambiar } } };
    }
    case 'catalogos': return { ok: true, data: CAT_DEF };
    case 'listar': {
      const l = db.movs.filter(m => m.fecha.slice(0, 7) === p.mes && (isAdmin || m.u === me.u));
      return { ok: true, data: l };
    }
    case 'registrar': {
      const ids = new Set(db.movs.map(m => m.id)); let n = 0;
      p.rows.forEach(r => { if (ids.has(r.id)) return; db.movs.push(Object.assign({}, r, { u: me.u, nombre: me.nombre, sync: new Date().toISOString(), estado: 'Vigente', motivo: '' })); n++; });
      save(); return { ok: true, data: { guardados: n } };
    }
    case 'anular': {
      if (!isAdmin) return { ok: false, code: 'permiso', error: 'Solo el administrador puede anular' };
      db.movs.forEach(m => { if (m.folio === p.folio) { m.estado = 'Anulado'; m.motivo = p.motivo; } });
      save(); return { ok: true, data: {} };
    }
    case 'cambiarPin': {
      if (me.pin !== p.actual) return { ok: false, code: 'pin', error: 'El PIN actual no es correcto' };
      me.pin = p.nuevo; me.debeCambiar = false; save(); return { ok: true, data: {} };
    }
    case 'adminUsuarios': return isAdmin ? { ok: true, data: db.users.map(u => ({ u: u.u, nombre: u.nombre, rol: u.rol, activo: u.activo !== false })) } : { ok: false, code: 'permiso', error: 'Sin permiso' };
    case 'guardarUsuario': {
      if (!isAdmin) return { ok: false, code: 'permiso', error: 'Sin permiso' };
      let u = db.users.find(x => x.u === p.u);
      if (!u) { if (!p.pin) return { ok: false, error: 'Falta el PIN' }; u = { u: p.u, activo: true }; db.users.push(u); }
      u.nombre = p.nombre; u.rol = p.rol; u.activo = p.activo !== false;
      if (p.pin) { u.pin = p.pin; u.debeCambiar = true; }
      save(); return { ok: true, data: {} };
    }
  }
  return { ok: false, error: 'Acción desconocida' };
}

/* ---------- PIN guardado en el celular (para entrar sin internet) ---------- */
async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode.apply(null, new Uint8Array(bits)));
}
async function guardarPinLocal(user, pin) {
  try { const salt = uuid(); ls.set('o_ph_' + user.u, { salt, hash: await hashPin(pin, salt), nombre: user.nombre, rol: user.rol }); } catch (e) { /* sin crypto */ }
}

/* ---------- cola de envío ---------- */
const getQ = () => ls.get('o_queue', []);
const setQ = q => ls.set('o_queue', q);
const pendientes = () => getQ().length;

async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const q = getQ(); if (!q.length) return;
    const resto = [];
    let corte = false;
    for (const it of q) {
      if (corte) { resto.push(it); continue; }
      const tok = tokens[it.u];
      if (!tok) { it.aviso = 'Falta iniciar sesión con internet'; resto.push(it); continue; }
      const r = it.op === 'anular' ? await api('anular', { folio: it.folio, motivo: it.motivo }, tok) : await api('registrar', { rows: it.rows }, tok);
      if (r.ok) continue;
      if (r.code === 'red') { corte = true; resto.push(it); continue; }
      if (r.code === 'auth') { delete tokens[it.u]; ls.set('o_tokens', tokens); it.aviso = 'Sesión vencida'; resto.push(it); continue; }
      it.aviso = r.error || 'Error'; it.fallos = (it.fallos || 0) + 1; resto.push(it);
    }
    setQ(resto);
  } finally { syncing = false; }
  if (S.user && S.online) await cargarMes(S.mes, true);
  if (['home', 'movs'].includes(S.screen)) render();
}

/* ---------- datos ---------- */
async function cargarCatalogos() {
  const r = await api('catalogos', {}, tokens[S.user.u]);
  if (r.ok && r.data) { S.cat = Object.assign({}, CAT_DEF, r.data); ls.set('o_cat', S.cat); }
}
async function cargarMes(mes, silencioso) {
  const key = 'o_movs_' + S.user.u + '_' + mes;
  const r = await api('listar', { mes }, tokens[S.user.u]);
  if (r.ok) { ls.set(key, r.data); if (mes === S.mes) S.movs = r.data; }
  else if (mes === S.mes) S.movs = ls.get(key, []);
  if (!silencioso && mes === S.mes) S.movs = S.movs || [];
}
function movsConPendientes() {
  const ids = new Set(S.movs.map(m => m.id));
  const extra = [];
  getQ().forEach(it => {
    if (it.op === 'anular' || !(S.user.rol === 'admin' || it.u === S.user.u)) return;
    it.rows.forEach(r => { if (r.fecha.slice(0, 7) === S.mes && !ids.has(r.id)) extra.push(Object.assign({}, r, { u: it.u, nombre: it.nombre, estado: 'Pendiente', motivo: '' })); });
  });
  return S.movs.concat(extra);
}
function agrupar(list) {
  const g = {}; const orden = [];
  list.forEach(m => { if (!g[m.folio]) { g[m.folio] = { folio: m.folio, rows: [] }; orden.push(g[m.folio]); } g[m.folio].rows.push(m); });
  orden.forEach(x => {
    const r = x.rows[0]; x.tipo = r.tipo; x.fecha = r.fecha; x.hora = r.hora; x.nombre = r.nombre; x.u = r.u;
    x.estado = x.rows.every(y => y.estado === 'Anulado') ? 'Anulado' : (x.rows.some(y => y.estado === 'Pendiente') ? 'Pendiente' : 'Vigente');
    x.total = x.rows.reduce((s, y) => s + Number(y.monto), 0);
    x.titulo = x.rows.length > 1 ? x.rows.length + ' compras · ' + (r.actividad || '') : (r.categoria || r.tipo);
  });
  return orden.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
}
function totales(list) {
  const t = { Oratorio: { i: 0, g: 0 }, DJN: { i: 0, g: 0 }, i: 0, g: 0 };
  list.forEach(m => {
    if (m.estado === 'Anulado') return;
    const x = Number(m.monto) || 0;
    const k = m.tipo === 'Ingreso' ? 'i' : 'g';
    t[k] += x; if (t[m.entidad]) t[m.entidad][k] += x;
  });
  return t;
}

/* ---------- ventanas y avisos ---------- */
function ask(opts) {
  return new Promise(res => {
    const f = (opts.fields || []).map(x => {
      if (x.type === 'select') return `<label for="m_${x.k}">${esc(x.label)}</label><select id="m_${x.k}">${x.options.map(o => `<option value="${esc(o[0])}" ${o[0] === x.value ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
      return `<label for="m_${x.k}">${esc(x.label)}</label><input id="m_${x.k}" type="${x.type || 'text'}" ${x.inputmode ? `inputmode="${x.inputmode}"` : ''} value="${esc(x.value || '')}" ${x.disabled ? 'disabled' : ''} autocomplete="off">` + (x.hint ? `<div class="hint">${esc(x.hint)}</div>` : '');
    }).join('');
    $ov.hidden = false;
    $ov.innerHTML = `<div class="modal" role="dialog"><h2>${esc(opts.title)}</h2>${opts.text ? `<p>${esc(opts.text)}</p>` : ''}${f}<div id="m_err"></div><div class="stack" style="margin-top:1rem"><button class="btn ${opts.danger ? 'red' : ''}" id="m_ok">${esc(opts.ok || 'Aceptar')}</button><button class="btn ghost" id="m_no">${esc(opts.cancel || 'Cancelar')}</button></div></div>`;
    const close = v => { $ov.hidden = true; $ov.innerHTML = ''; res(v); };
    document.getElementById('m_no').onclick = () => close(null);
    document.getElementById('m_ok').onclick = () => {
      const out = {}; (opts.fields || []).forEach(x => { out[x.k] = document.getElementById('m_' + x.k).value.trim(); });
      const e = opts.validate ? opts.validate(out) : '';
      if (e) { document.getElementById('m_err').innerHTML = `<div class="err">${esc(e)}</div>`; return; }
      close(out);
    };
    const first = $ov.querySelector('input:not([disabled]),select'); if (first) setTimeout(() => first.focus(), 50);
  });
}
function busy(txt) { let b = document.getElementById('busy'); if (!txt) { if (b) b.remove(); return; } if (!b) { b = document.createElement('div'); b.id = 'busy'; b.className = 'busy'; document.body.appendChild(b); } b.textContent = txt; }

/* ---------- piezas de pantalla ---------- */
function topbar() {
  const u = S.user;
  return `<header class="top"><img src="logo.png" alt="Salesianos, Desarrollo Juvenil del Norte A.C.">` +
    (u ? `<div class="who"><b>${esc(u.nombre)}</b>${u.rol === 'admin' ? 'Administrador' : 'Oficina'}</div>` : '') + `</header>` + statusPill();
}
function statusPill() {
  const n = pendientes();
  if (DEMO) return `<div class="pill demo">MODO DEMOSTRACIÓN · ${ls.get('o_sim_offline', false) ? 'Sin internet (simulado)' : 'Con internet (simulado)'} <button data-act="toggleSim">${ls.get('o_sim_offline', false) ? 'Conectar' : 'Simular sin internet'}</button></div>` + (n ? `<div class="pill off">⏳ ${n} movimiento${n > 1 ? 's' : ''} por enviar <button data-act="sync">Enviar ahora</button></div>` : '');
  if (!S.online) return `<div class="pill off">Sin internet — todo se guarda en este celular${n ? ' · ' + n + ' por enviar' : ''}</div>`;
  if (n) return `<div class="pill off">⏳ ${n} movimiento${n > 1 ? 's' : ''} por enviar <button data-act="sync">Enviar ahora</button></div>`;
  return S.user ? `<div class="pill on">✔ Todo enviado</div>` : '';
}
function tagEnt(e) { return `<span class="tag ${e === 'DJN' ? 'dj' : ''}">${esc(e)}</span>`; }

/* ---------- pantallas ---------- */
const V = {};

V.login = () => {
  if (!S.sel) {
    const list = S.users.length ? S.users.map(u => `<button class="opt" data-act="pickUser" data-u="${esc(u.u)}"><span>${esc(u.nombre)}</span><span class="chev">›</span></button>`).join('') : `<div class="card">No se pudo cargar la lista de personas. Revise la conexión a internet e intente de nuevo.</div><button class="btn" style="margin-top:.8rem" data-act="reloadUsers">Intentar de nuevo</button>`;
    return `${topbar()}<main><h1>¿Quién va a trabajar?</h1><div class="users">${list}</div>${DEMO ? `<p class="hint" style="margin-top:1.5rem">Demostración: padre → PIN 1234 · maría → PIN 1111</p>` : ''}</main>`;
  }
  const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i < S.pin.length ? 'f' : ''}"></i>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'].map(k => k === 'del' ? `<button data-act="pinDel" aria-label="Borrar">⌫</button>` : k === 'go' ? `<button class="go" data-act="pinGo" ${S.pin.length < 4 ? 'disabled' : ''}>Entrar</button>` : `<button data-act="pinKey" data-k="${k}">${k}</button>`).join('');
  return `${topbar()}<main><h1>Hola, ${esc(S.sel.nombre)}</h1><p class="muted" style="text-align:center">Escriba su PIN (de 4 a 6 números)</p><div class="dots">${dots}</div>${S.msg ? `<div class="err">${esc(S.msg)}</div>` : ''}<div class="pad">${keys}</div><button class="btn ghost" style="margin-top:1rem" data-act="otraPersona">← No soy yo</button></main>`;
};

V.home = () => {
  const list = movsConPendientes();
  const t = totales(list); const admin = S.user.rol === 'admin';
  let resumen;
  if (admin) {
    const c = e => `<div class="card stat"><div class="lbl">${e}</div><div class="val ${t[e].i - t[e].g < 0 ? 'neg' : ''}">${money(t[e].i - t[e].g)}</div><div class="sub">Entró ${money(t[e].i)} · Salió ${money(t[e].g)}</div></div>`;
    resumen = `<h2>Saldo de ${monthLabel(S.mes)}</h2><div class="cards2">${c('Oratorio')}${c('DJN')}</div>`;
  } else {
    resumen = `<h2>Lo que usted registró en ${monthLabel(S.mes)}</h2><div class="cards2"><div class="card stat"><div class="lbl">Ingresos</div><div class="val">${money(t.i)}</div></div><div class="card stat"><div class="lbl">Gastos</div><div class="val neg">${money(t.g)}</div></div></div>`;
  }
  return `${topbar()}<main><div class="stack"><button class="btn huge" data-act="nuevo" data-t="Ingreso">＋ Registrar INGRESO<small>Dinero que entró</small></button><button class="btn huge red" data-act="nuevo" data-t="Gasto">－ Registrar GASTO<small>Dinero que salió</small></button></div>${resumen}
  <div class="stack" style="margin-top:1rem"><button class="btn light" data-act="verMovs">📋 Ver movimientos</button>${admin ? `<button class="btn light" data-act="verAdmin">👥 Personas y hoja de Excel</button>` : ''}<button class="btn ghost" data-act="salir">Salir</button></div><p class="hint" style="text-align:center">Versión ${esc(C.VERSION || '')}</p></main>`;
};

/* ----- Asistente de captura ----- */
function newDraft(tipo) { return { tipo, monto: '', tipoEntrada: '', origen: '', metodo: '', nota: '', actividad: '', partidas: [], cur: {}, lugar: '', corrige: null }; }
const FLOW = {
  Ingreso: ['monto', 'tipoEntrada', 'origen', 'metodo', 'nota', 'confirm'],
  Gasto: ['actividad', 'pConcepto', 'pMonto', 'pEntidad', 'pLista', 'lugar', 'confirm']
};
function optsHtml(list, cur, field, otro) {
  const items = list.map(x => { const v = typeof x === 'string' ? x : x.v; const sub = typeof x === 'string' ? '' : `<small>→ ${esc(x.e)}</small>`; return `<button class="opt ${cur === v ? 'sel' : ''}" data-act="pick" data-f="${field}" data-v="${esc(v)}"><span>${esc(v)}</span>${sub}</button>`; });
  if (otro) items.push(`<button class="opt" data-act="pickOtro" data-f="${field}"><span>✎ Otro (escribir)</span></button>`);
  return `<div class="opts">${items.join('')}</div>`;
}
const STEPS = {
  monto: { t: () => '¿Cuánto dinero entró?', body: d => `<input id="in_monto" class="money" type="text" inputmode="decimal" placeholder="$ 0.00" value="${esc(d.monto)}" autocomplete="off"><p class="hint" style="text-align:center">Escriba solo números. Ejemplo: 1500 o 250.50</p>`, ok: d => montoOk(d.monto) },
  tipoEntrada: { t: () => '¿Qué tipo de entrada es?', body: d => optsHtml(S.cat.TipoIngreso, d.tipoEntrada, 'tipoEntrada', false) + `<p class="hint">La entrada ordinaria de la oficina se anota a DJN. La kermés se anota al Oratorio.</p>`, ok: d => !!d.tipoEntrada, auto: true },
  origen: { t: () => '¿De dónde viene el dinero?', body: d => optsHtml(S.cat.OrigenIngreso, d.origen, 'origen', true), ok: d => !!d.origen, auto: true },
  metodo: { t: () => '¿Cómo entró?', body: d => optsHtml(S.cat.Metodo, d.metodo, 'metodo', false), ok: d => !!d.metodo, auto: true },
  nota: { t: () => '¿Quiere anotar algo más?', body: d => `<label for="in_nota">Nota (opcional)</label><input id="in_nota" type="text" value="${esc(d.nota)}" placeholder="Ejemplo: kermés de octubre, familia Pérez" autocomplete="off">`, ok: () => true },
  actividad: { t: () => '¿Para qué actividad fue el gasto?', body: d => optsHtml(S.cat.Actividad, d.actividad, 'actividad', true), ok: d => !!d.actividad, auto: true },
  pConcepto: { t: d => d.partidas.length ? 'Otra cosa que se compró' : '¿En qué se gastó?', body: d => optsHtml(S.cat.Concepto, d.cur.concepto, 'cur.concepto', true), ok: d => !!d.cur.concepto, auto: true },
  pMonto: { t: d => `¿Cuánto costó "${d.cur.concepto}"?`, body: d => `<input id="in_pmonto" class="money" type="text" inputmode="decimal" placeholder="$ 0.00" value="${esc(d.cur.monto || '')}" autocomplete="off"><p class="hint" style="text-align:center">Solo lo que costó esta cosa. Si compró más cosas, las agrega después.</p>`, ok: d => montoOk(d.cur.monto) },
  pEntidad: { t: () => '¿A quién se le cobra este gasto?', body: d => `<div class="opts">${ENTIDADES.map(e => `<button class="opt ${d.cur.entidad === e ? 'sel' : ''}" data-act="pick" data-f="cur.entidad" data-v="${e}"><span>${e === 'DJN' ? 'DJN' : 'Oratorio'}</span></button>`).join('')}</div>`, ok: d => !!d.cur.entidad, auto: true },
  pLista: { t: () => '¿Qué más se compró?', body: d => `<div class="card"><table class="sum">${d.partidas.map((p, i) => `<tr><td>${esc(p.concepto)}<br>${tagEnt(p.entidad)}<button class="btn small ghost" style="min-height:40px;padding:0 .3rem" data-act="quitarP" data-i="${i}">quitar</button></td><td>${money(p.monto)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td>${money(d.partidas.reduce((s, p) => s + p.monto, 0))}</td></tr></table></div><div class="stack" style="margin-top:1rem"><button class="btn light" data-act="otraP">＋ Agregar otra cosa</button></div><p class="hint">Si ya anotó todo, toque “Siguiente”.</p>`, ok: d => d.partidas.length > 0 },
  lugar: { t: () => '¿Dónde se compró?', body: d => `<label for="in_lugar">Lugar o tienda (opcional)</label><input id="in_lugar" type="text" value="${esc(d.lugar)}" placeholder="Ejemplo: Soriana, ferretería López" autocomplete="off"><label for="in_nota">Nota (opcional)</label><input id="in_nota" type="text" value="${esc(d.nota)}" autocomplete="off">`, ok: () => true },
  confirm: { t: () => 'Revise antes de guardar', body: d => confirmHtml(d), ok: () => true, last: true }
};
function montoOk(v) { const n = parseMonto(v); return n > 0 && n < 10000000; }
function parseMonto(v) { const s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN; return Math.round(parseFloat(s) * 100) / 100; }
function entidadIngreso(d) { const t = S.cat.TipoIngreso.find(x => x.v === d.tipoEntrada); return (t && t.e) || 'Oratorio'; }
function confirmHtml(d) {
  const ahora = new Date();
  const quien = `<p class="hint" style="margin-top:1rem">Se guardará a nombre de <b>${esc(S.user.nombre)}</b>, con la fecha y hora de ahora (${fechaCorta(todayStr())}, ${pad(ahora.getHours())}:${pad(ahora.getMinutes())}).</p>`;
  if (d.tipo === 'Ingreso') {
    const e = entidadIngreso(d);
    return `<div class="card"><table class="sum"><tr><td>Monto</td><td style="font-size:1.4rem;color:var(--navy)">${money(parseMonto(d.monto))}</td></tr><tr><td>Tipo</td><td>${esc(d.tipoEntrada)}</td></tr><tr><td>Se anota a</td><td>${tagEnt(e)}</td></tr><tr><td>De dónde</td><td>${esc(d.origen)}</td></tr><tr><td>Cómo entró</td><td>${esc(d.metodo)}</td></tr>${d.nota ? `<tr><td>Nota</td><td>${esc(d.nota)}</td></tr>` : ''}</table></div>${quien}`;
  }
  const tot = d.partidas.reduce((s, p) => s + p.monto, 0);
  const porE = ENTIDADES.map(e => ({ e, v: d.partidas.filter(p => p.entidad === e).reduce((s, p) => s + p.monto, 0) })).filter(x => x.v > 0);
  return `<div class="card"><table class="sum"><tr><td>Actividad</td><td>${esc(d.actividad)}</td></tr>${d.partidas.map(p => `<tr><td>${esc(p.concepto)} ${tagEnt(p.entidad)}</td><td>${money(p.monto)}</td></tr>`).join('')}<tr><td><b>Total del gasto</b></td><td style="font-size:1.3rem;color:var(--red)">${money(tot)}</td></tr>${porE.length > 1 ? porE.map(x => `<tr><td class="muted">Se carga a ${x.e}</td><td>${money(x.v)}</td></tr>`).join('') : ''}${d.lugar ? `<tr><td>Lugar</td><td>${esc(d.lugar)}</td></tr>` : ''}${d.nota ? `<tr><td>Nota</td><td>${esc(d.nota)}</td></tr>` : ''}</table></div>${quien}`;
}
V.wizard = () => {
  const W = S.W; const st = STEPS[W.step]; const d = W.d;
  const color = d.tipo === 'Gasto' ? 'red' : '';
  const next = st.last
    ? `<button class="btn ${color}" data-act="guardar" ${W.saving ? 'disabled' : ''}>✔ Guardar</button>`
    : `<button class="btn ${color}" data-act="next" ${st.ok(d) ? '' : 'disabled'}>Siguiente →</button>`;
  const head = `<div class="hint" style="font-weight:700;color:${d.tipo === 'Gasto' ? 'var(--red)' : 'var(--navy)'}">${d.corrige ? 'CORREGIR ' : 'NUEVO '}${d.tipo.toUpperCase()}</div>`;
  return `${topbar()}<main>${head}<h1>${esc(st.t(d))}</h1>${W.err ? `<div class="err">${esc(W.err)}</div>` : ''}${st.body(d)}</main><div class="foot"><button class="btn light" data-act="back">← Atrás</button>${next}</div>`;
};
function setPath(d, path, v) { const p = path.split('.'); if (p.length === 2) d[p[0]][p[1]] = v; else d[p[0]] = v; }
function stepNext() {
  const W = S.W, d = W.d; const flow = FLOW[d.tipo]; W.err = '';
  readInputs();
  const st = STEPS[W.step];
  if (!st.ok(d)) return;
  if (W.step === 'pEntidad') { d.partidas.push({ concepto: d.cur.concepto, monto: parseMonto(d.cur.monto), entidad: d.cur.entidad }); d.cur = {}; }
  W.hist.push(W.step);
  W.step = flow[flow.indexOf(W.step) + 1];
  render(); window.scrollTo(0, 0);
}
function stepBack() {
  const W = S.W;
  readInputs();
  if (!W.hist.length) { S.W = null; return go('home'); }
  if (W.step === 'pLista' || (W.step === 'lugar' && W.d.partidas.length)) { /* se regresa a la lista */ }
  const prev = W.hist.pop();
  if (W.step === 'pLista' && prev === 'pEntidad') { const p = W.d.partidas.pop(); W.d.cur = p ? { concepto: p.concepto, monto: String(p.monto), entidad: p.entidad } : {}; }
  W.step = prev; render();
}
function readInputs() {
  const W = S.W; if (!W) return; const d = W.d;
  const g = id => { const e = document.getElementById(id); return e ? e.value : null; };
  let v;
  if ((v = g('in_monto')) !== null) d.monto = v;
  if ((v = g('in_pmonto')) !== null) d.cur.monto = v;
  if ((v = g('in_nota')) !== null) d.nota = v.trim();
  if ((v = g('in_lugar')) !== null) d.lugar = v.trim();
}
function startWizard(tipo, draft) { S.W = { d: draft || newDraft(tipo), step: FLOW[tipo][0], hist: [], err: '', saving: false }; go('wizard'); }
function draftFromFolio(g) {
  const r = g.rows; const d = newDraft(g.tipo); d.corrige = g.folio; d.nota = r[0].concepto || '';
  if (g.tipo === 'Ingreso') { d.monto = String(r[0].monto); d.tipoEntrada = r[0].actividad; d.origen = r[0].categoria; d.metodo = r[0].metodo; }
  else { d.actividad = r[0].actividad; d.lugar = r[0].lugar || ''; d.partidas = r.map(x => ({ concepto: x.categoria, monto: Number(x.monto), entidad: x.entidad })); }
  return d;
}
async function guardar() {
  const W = S.W; if (!W || W.saving) return; const d = W.d;
  W.saving = true; render();
  const fecha = todayStr(), hora = timeStr(), folio = newFolio();
  const base = { folio, tipo: d.tipo, fecha, hora, concepto: d.nota || '', lugar: d.lugar || '', corrige: d.corrige || '' };
  let rows;
  if (d.tipo === 'Ingreso') rows = [Object.assign({}, base, { id: uuid(), entidad: entidadIngreso(d), actividad: d.tipoEntrada, categoria: d.origen, metodo: d.metodo, monto: parseMonto(d.monto) })];
  else rows = d.partidas.map(p => Object.assign({}, base, { id: uuid(), entidad: p.entidad, actividad: d.actividad, categoria: p.concepto, metodo: '', monto: p.monto }));
  const q = getQ();
  q.push({ op: 'registrar', u: S.user.u, nombre: S.user.nombre, rows, t: Date.now() });
  if (d.corrige) q.push({ op: 'anular', u: S.user.u, nombre: S.user.nombre, folio: d.corrige, motivo: 'Corregido en el folio ' + folio, t: Date.now() });
  setQ(q);
  S.ultimo = { folio, total: rows.reduce((s, r) => s + r.monto, 0), tipo: d.tipo };
  S.W = null; go('exito');
  await sync();
  if (S.screen === 'exito') render();
}

V.exito = () => {
  const u = S.ultimo; const pend = getQ().some(it => it.op === 'registrar' && it.rows[0].folio === u.folio);
  return `${topbar()}<main><div class="big-ok ${pend ? 'wait' : ''}"><div class="check">${pend ? '⏳' : '✔'}</div><h1>${pend ? 'Guardado en este celular' : '¡Guardado!'}</h1><p style="font-size:1.3rem;font-weight:800">${u.tipo === 'Ingreso' ? 'Ingreso' : 'Gasto'} de ${money(u.total)}</p><p class="muted">${pend ? 'Se enviará a la hoja de Excel en cuanto haya internet. No necesita hacer nada más.' : 'Ya aparece en la hoja de Excel.'}</p><p class="hint">Folio ${esc(u.folio)}</p></div><div class="stack"><button class="btn" data-act="nuevo" data-t="${u.tipo}">Registrar otro ${u.tipo === 'Ingreso' ? 'ingreso' : 'gasto'}</button><button class="btn light" data-act="home">Ir al inicio</button></div></main>`;
};

/* ----- Movimientos ----- */
V.movs = () => {
  const gs = agrupar(movsConPendientes());
  const t = totales(movsConPendientes());
  const lista = gs.length ? gs.map(g => {
    const ents = [...new Set(g.rows.map(r => r.entidad))].map(tagEnt).join('');
    const est = g.estado === 'Anulado' ? '<span class="tag void">Anulado</span>' : g.estado === 'Pendiente' ? '<span class="tag warn">Por enviar</span>' : '';
    return `<button class="mov ${g.estado === 'Anulado' ? 'void' : ''}" data-act="detalle" data-f="${esc(g.folio)}"><div class="ic ${g.tipo === 'Ingreso' ? 'in' : 'out'}">${g.tipo === 'Ingreso' ? '+' : '−'}</div><div class="mid"><b>${esc(g.titulo)}</b><small>${fechaCorta(g.fecha)} ${horaCorta(g.hora)} · ${esc(g.nombre)}</small><div style="margin-top:.2rem">${ents}${est}</div></div><div class="amt" style="color:${g.tipo === 'Ingreso' ? 'var(--navy)' : 'var(--red)'}">${g.tipo === 'Ingreso' ? '+' : '−'}${money(g.total)}</div></button>`;
  }).join('') : `<div class="card" style="text-align:center">No hay movimientos en este mes.</div>`;
  return `${topbar()}<main><div class="monthnav"><button class="btn light" data-act="mes" data-n="-1" aria-label="Mes anterior">‹</button><b>${monthLabel(S.mes)}</b><button class="btn light" data-act="mes" data-n="1" aria-label="Mes siguiente">›</button></div>
  <div class="cards2" style="margin-bottom:1rem"><div class="card stat"><div class="lbl">Entró</div><div class="val">${money(t.i)}</div></div><div class="card stat"><div class="lbl">Salió</div><div class="val neg">${money(t.g)}</div></div></div>
  ${S.cargando ? '<p class="hint" style="text-align:center">Cargando…</p>' : ''}<div class="stack">${lista}</div></main><div class="foot"><button class="btn light" data-act="home" style="flex:1">← Inicio</button></div>`;
};
V.detalle = () => {
  const g = agrupar(movsConPendientes()).find(x => x.folio === S.detalle);
  if (!g) { return `${topbar()}<main><p>No se encontró el movimiento.</p><button class="btn" data-act="verMovs">Volver</button></main>`; }
  const r0 = g.rows[0]; const admin = S.user.rol === 'admin';
  const filas = g.rows.map(r => `<tr><td>${esc(r.categoria)} ${tagEnt(r.entidad)}${g.tipo === 'Ingreso' ? `<br><span class="muted">${esc(r.actividad)} · ${esc(r.metodo)}</span>` : ''}</td><td>${money(r.monto)}</td></tr>`).join('');
  const acciones = admin && g.estado === 'Vigente' ? `<div class="stack" style="margin-top:1rem"><button class="btn light" data-act="corregir" data-f="${esc(g.folio)}">✎ Corregir (hacer de nuevo)</button><button class="btn red" data-act="anular" data-f="${esc(g.folio)}">✖ Anular</button></div>` : '';
  return `${topbar()}<main><h1>${g.tipo === 'Ingreso' ? 'Ingreso' : 'Gasto'} · ${money(g.total)}</h1>
  <div class="card"><table class="sum"><tr><td>Fecha y hora</td><td>${fechaCorta(g.fecha)}<br>${horaCorta(g.hora)}</td></tr><tr><td>Lo registró</td><td>${esc(g.nombre)}</td></tr>${g.tipo === 'Gasto' ? `<tr><td>Actividad</td><td>${esc(r0.actividad)}</td></tr>` : ''}${filas}${r0.lugar ? `<tr><td>Lugar</td><td>${esc(r0.lugar)}</td></tr>` : ''}${r0.concepto ? `<tr><td>Nota</td><td>${esc(r0.concepto)}</td></tr>` : ''}<tr><td>Folio</td><td style="font-size:.8rem">${esc(g.folio)}</td></tr>${g.estado === 'Anulado' ? `<tr><td>Estado</td><td>Anulado<br><span class="muted" style="font-weight:500">${esc(r0.motivo || '')}</span></td></tr>` : ''}${g.estado === 'Pendiente' ? `<tr><td>Estado</td><td>Por enviar</td></tr>` : ''}</table></div>${acciones}</main><div class="foot"><button class="btn light" data-act="verMovs" style="flex:1">← Volver</button></div>`;
};

/* ----- Administración ----- */
V.admin = () => {
  const l = (S.adminUsers || []).map(u => `<button class="opt" data-act="editU" data-u="${esc(u.u)}"><span>${esc(u.nombre)}<br><small>${esc(u.u)} · ${u.rol === 'admin' ? 'Administrador' : 'Oficina'}${u.activo ? '' : ' · INACTIVO'}</small></span><span class="chev">✎</span></button>`).join('');
  return `${topbar()}<main><h1>Personas y Excel</h1>
  ${C.SHEET_URL ? `<a class="btn" style="text-decoration:none" href="${esc(C.SHEET_URL)}" target="_blank" rel="noopener">📊 Ver en Excel (Google Sheets)</a>` : `<div class="card muted">Falta poner el enlace de la hoja en <b>config.js</b> (SHEET_URL).</div>`}
  <h2>Personas con acceso</h2>${S.adminErr ? `<div class="err">${esc(S.adminErr)}</div>` : ''}<div class="opts">${l}</div>
  <div class="stack" style="margin-top:1rem"><button class="btn light" data-act="nuevoU">＋ Agregar persona</button><button class="btn light" data-act="cambiarPin">🔑 Cambiar mi PIN</button></div></main><div class="foot"><button class="btn light" data-act="home" style="flex:1">← Inicio</button></div>`;
};
async function cargarAdmin() { const r = await api('adminUsuarios', {}, tokens[S.user.u]); S.adminErr = r.ok ? '' : (r.code === 'red' ? 'Necesita internet para ver o cambiar personas.' : r.error); if (r.ok) S.adminUsers = r.data; }
const PIN_OK = v => /^\d{4,6}$/.test(v);
async function editarUsuario(u) {
  const nuevo = !u; u = u || { u: '', nombre: '', rol: 'capturista', activo: true };
  const r = await ask({
    title: nuevo ? 'Agregar persona' : 'Editar persona', ok: 'Guardar',
    fields: [
      { k: 'nombre', label: 'Nombre', value: u.nombre },
      { k: 'u', label: 'Usuario (para identificarlo)', value: u.u, disabled: !nuevo, hint: nuevo ? 'Solo letras minúsculas y números, sin espacios. Ejemplo: maria' : '' },
      { k: 'rol', label: 'Tipo de persona', type: 'select', value: u.rol, options: [['capturista', 'Oficina (registra y ve lo suyo)'], ['admin', 'Administrador (ve todo y corrige)']] },
      { k: 'pin', label: nuevo ? 'PIN (4 a 6 números)' : 'PIN nuevo (déjelo vacío para no cambiarlo)', type: 'tel', inputmode: 'numeric' },
      { k: 'activo', label: 'Estado', type: 'select', value: u.activo ? 'si' : 'no', options: [['si', 'Activa (puede entrar)'], ['no', 'Inactiva (ya no puede entrar)']] }
    ],
    validate: o => !o.nombre ? 'Escriba el nombre.' : !/^[a-z0-9]{3,20}$/.test(o.u) ? 'El usuario debe tener de 3 a 20 letras minúsculas o números.' : (nuevo && !PIN_OK(o.pin)) ? 'El PIN debe tener de 4 a 6 números.' : (o.pin && !PIN_OK(o.pin)) ? 'El PIN debe tener de 4 a 6 números.' : ''
  });
  if (!r) return;
  busy('Guardando…');
  const res = await api('guardarUsuario', { u: nuevo ? r.u : u.u, nombre: r.nombre, rol: r.rol, pin: r.pin, activo: r.activo === 'si' }, tokens[S.user.u]);
  busy();
  if (!res.ok) { S.adminErr = res.code === 'red' ? 'Necesita internet para guardar.' : res.error; } else { await cargarAdmin(); await cargarUsuarios(); }
  render();
}
async function cambiarMiPin(forzado) {
  const r = await ask({
    title: forzado ? 'Elija su PIN personal' : 'Cambiar mi PIN', text: forzado ? 'Por seguridad, cambie el PIN que le dieron por uno que solo usted conozca.' : '', ok: 'Guardar PIN',
    fields: [{ k: 'actual', label: 'PIN actual', type: 'tel', inputmode: 'numeric' }, { k: 'nuevo', label: 'PIN nuevo (4 a 6 números)', type: 'tel', inputmode: 'numeric' }, { k: 'rep', label: 'Repita el PIN nuevo', type: 'tel', inputmode: 'numeric' }],
    cancel: forzado ? 'Ahora no' : 'Cancelar',
    validate: o => !PIN_OK(o.nuevo) ? 'El PIN nuevo debe tener de 4 a 6 números.' : o.nuevo !== o.rep ? 'Los dos PIN nuevos no son iguales.' : ''
  });
  if (!r) return;
  busy('Guardando…');
  const res = await api('cambiarPin', { actual: r.actual, nuevo: r.nuevo }, tokens[S.user.u]);
  busy();
  if (res.ok) { await guardarPinLocal(S.user, r.nuevo); await ask({ title: '✔ PIN cambiado', text: 'Desde ahora entre con su PIN nuevo.', ok: 'Entendido', cancel: ' ' }); }
  else await ask({ title: 'No se pudo cambiar', text: res.code === 'red' ? 'Necesita internet para cambiar el PIN.' : res.error, ok: 'Entendido', cancel: ' ' });
}

/* ---------- navegación y eventos ---------- */
function render() { $app.innerHTML = V[S.screen](); }
function go(s) { S.screen = s; render(); window.scrollTo(0, 0); }
async function cargarUsuarios() {
  const r = await api('usuarios');
  if (r.ok) { S.users = r.data; ls.set('o_users', r.data); }
}
async function entrar() {
  const u = S.sel; const pin = S.pin; S.msg = '';
  busy('Entrando…');
  const r = await api('login', { u: u.u, pin });
  let user = null;
  if (r.ok) {
    user = r.data.user; tokens[user.u] = r.data.token; ls.set('o_tokens', tokens); await guardarPinLocal(user, pin);
  } else if (r.code === 'red') {
    const ph = ls.get('o_ph_' + u.u, null);
    if (!ph) S.msg = 'Sin internet. La primera vez en este celular necesita conexión.';
    else { try { if (await hashPin(pin, ph.salt) === ph.hash) user = { u: u.u, nombre: ph.nombre, rol: ph.rol }; else S.msg = 'El PIN no es correcto.'; } catch (e) { S.msg = 'No se pudo verificar sin internet.'; } }
  } else S.msg = r.error || 'El PIN no es correcto';
  busy();
  S.pin = '';
  if (!user) { render(); return; }
  S.user = user; S.mes = monthKey(new Date());
  S.movs = ls.get('o_movs_' + user.u + '_' + S.mes, []);
  go('home');
  if (S.online) { await cargarCatalogos(); await sync(); await cargarMes(S.mes, true); render(); if (user.debeCambiar) { await cambiarMiPin(true); } }
}
function salir() { S.user = null; S.sel = null; S.pin = ''; S.W = null; go('login'); cargarUsuarios().then(() => { if (S.screen === 'login') render(); }); }

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, D = b.dataset;
  switch (a) {
    case 'pickUser': S.sel = S.users.find(u => u.u === D.u); S.pin = ''; S.msg = ''; render(); break;
    case 'otraPersona': S.sel = null; S.pin = ''; S.msg = ''; render(); break;
    case 'reloadUsers': busy('Cargando…'); await cargarUsuarios(); busy(); render(); break;
    case 'pinKey': if (S.pin.length < 6) { S.pin += D.k; render(); } break;
    case 'pinDel': S.pin = S.pin.slice(0, -1); render(); break;
    case 'pinGo': if (S.pin.length >= 4) entrar(); break;
    case 'salir': salir(); break;
    case 'home': go('home'); break;
    case 'nuevo': startWizard(D.t); break;
    case 'next': stepNext(); break;
    case 'back': stepBack(); break;
    case 'pick': { readInputs(); setPath(S.W.d, D.f, D.v); const st = STEPS[S.W.step]; if (st.auto) stepNext(); else render(); break; }
    case 'pickOtro': {
      readInputs();
      const r = await ask({ title: 'Escriba su respuesta', fields: [{ k: 'txt', label: '' }], ok: 'Aceptar', validate: o => o.txt ? '' : 'Escriba algo.' });
      if (r) { setPath(S.W.d, D.f, r.txt.slice(0, 80)); stepNext(); }
      break;
    }
    case 'otraP': S.W.d.cur = {}; S.W.hist.push('pLista'); S.W.step = 'pConcepto'; render(); break;
    case 'quitarP': S.W.d.partidas.splice(+D.i, 1); render(); break;
    case 'guardar': readInputs(); guardar(); break;
    case 'verMovs': S.detalle = null; go('movs'); S.cargando = true; render(); await cargarMes(S.mes); S.cargando = false; if (S.screen === 'movs') render(); break;
    case 'mes': S.mes = shiftMonth(S.mes, +D.n); S.movs = ls.get('o_movs_' + S.user.u + '_' + S.mes, []); S.cargando = true; render(); await cargarMes(S.mes); S.cargando = false; if (S.screen === 'movs') render(); break;
    case 'detalle': S.detalle = D.f; go('detalle'); break;
    case 'corregir': { const g = agrupar(movsConPendientes()).find(x => x.folio === D.f); if (g) startWizard(g.tipo, draftFromFolio(g)); break; }
    case 'anular': {
      const r = await ask({ title: 'Anular movimiento', text: 'El movimiento no se borra: queda marcado como anulado, con su motivo.', ok: 'Sí, anular', danger: true, fields: [{ k: 'motivo', label: '¿Por qué se anula?' }], validate: o => o.motivo ? '' : 'Escriba el motivo.' });
      if (r) { const q = getQ(); q.push({ op: 'anular', u: S.user.u, nombre: S.user.nombre, folio: D.f, motivo: r.motivo + ' (' + S.user.nombre + ')', t: Date.now() }); setQ(q); busy('Anulando…'); await sync(); busy(); go('movs'); }
      break;
    }
    case 'verAdmin': go('admin'); busy('Cargando…'); await cargarAdmin(); busy(); if (S.screen === 'admin') render(); break;
    case 'editU': editarUsuario(S.adminUsers.find(u => u.u === D.u)); break;
    case 'nuevoU': editarUsuario(null); break;
    case 'cambiarPin': cambiarMiPin(false); break;
    case 'sync': busy('Enviando…'); await sync(); busy(); render(); break;
    case 'toggleSim': ls.set('o_sim_offline', !ls.get('o_sim_offline', false)); S.online = !ls.get('o_sim_offline', false); if (S.online && S.user) await sync(); render(); break;
  }
});
document.addEventListener('input', ev => {
  if (!S.W) return;
  if (ev.target.id === 'in_monto' || ev.target.id === 'in_pmonto') {
    readInputs(); const btn = document.querySelector('[data-act="next"]'); if (btn) btn.disabled = !STEPS[S.W.step].ok(S.W.d);
  }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && S.W && ev.target.tagName === 'INPUT' && !$ov.innerHTML) { const b = document.querySelector('[data-act="next"]:not([disabled])'); if (b) b.click(); } });
window.addEventListener('online', () => { S.online = true; if (S.user) sync(); });
window.addEventListener('offline', () => { S.online = false; if (S.screen !== 'wizard') render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && pendientes()) sync(); });
setInterval(() => { if (S.user && pendientes() && !(S.screen === 'wizard') && $ov.hidden) sync(); }, 60000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
cargarUsuarios().then(() => { if (S.screen === 'login') render(); });

// Para pruebas automáticas
window.__app = { S, getQ, sync };
})();
