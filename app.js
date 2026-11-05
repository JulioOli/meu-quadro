const KEY = "mesa-v1";
const COLORS = ["#d7b07a", "#8fbfa8", "#e08b78", "#8eabcf", "#c48b9f", "#b7a3d6"];

const ui = {
  view: "kanban",
  q: "",
  projectId: "",
  sprintId: "",
  hideDone: false,
  openId: null,
  ganttMode: "month",
  ganttAnchor: startOfMonth(new Date()),
  timeDay: iso(new Date()),
  focus: null,
};

let state = load();
let dragged = false;

function defaultState() {
  return {
    version: 1,
    columns: [
      { id: "ideias", name: "Ideias", kind: "start" },
      { id: "fazer", name: "A fazer", kind: "wait" },
      { id: "fazendo", name: "Fazendo", kind: "wait" },
      { id: "pausado", name: "Pausado", kind: "wait" },
      { id: "revisao", name: "Revisão", kind: "wait" },
      { id: "feito", name: "Feito", kind: "done" },
    ],
    types: ["Tarefa", "Pessoal", "Melhoria", "Ideia"],
    projects: [],
    tasks: [],
    entries: [],
    sprints: [],
    timer: null,
    seq: { task: 1, project: 1, sprint: 1 },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...data,
      columns: data.columns?.length ? data.columns : base.columns,
      types: data.types?.length ? data.types : base.types,
      seq: { ...base.seq, ...(data.seq || {}) },
    };
  } catch {
    return defaultState();
  }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function iso(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function fmtDate(s) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function fmtLong(s) {
  return parseISO(s).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}

function fmtHM(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function fmtHMS(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const z = (n) => String(n).padStart(2, "0");
  return `${z(h)}:${z(m)}:${z(r)}`;
}

function parseHM(raw) {
  const s = String(raw || "").trim();
  if (/^\d+:\d{1,2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    if (m > 59) return null;
    return h * 60 + m;
  }
  if (/^\d+([.,]\d+)?$/.test(s)) return Math.round(parseFloat(s.replace(",", ".")) * 60);
  return null;
}

function column(id) {
  return state.columns.find((c) => c.id === id);
}

function project(id) {
  return state.projects.find((p) => p.id === id);
}

function task(id) {
  return state.tasks.find((t) => t.id === id);
}

function sprint(id) {
  return state.sprints.find((s) => s.id === id);
}

function startColumn() {
  return state.columns.find((c) => c.kind === "start") || state.columns[0];
}

function isDone(t) {
  return column(t.statusId)?.kind === "done";
}

function logged(taskId) {
  return state.entries.filter((e) => e.taskId === taskId).reduce((a, e) => a + e.minutes, 0);
}

function visibleTasks() {
  const q = ui.q.trim().toLowerCase();
  return state.tasks.filter((t) => {
    if (ui.projectId && t.projectId !== ui.projectId) return false;
    if (ui.sprintId === "none" && t.sprintId) return false;
    if (ui.sprintId && ui.sprintId !== "none" && t.sprintId !== ui.sprintId) return false;
    if (ui.hideDone && isDone(t)) return false;
    if (!q) return true;
    const blob = [t.code, t.title, t.description, project(t.projectId)?.name, ...(t.tags || [])]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}

function tasksIn(colId) {
  return visibleTasks().filter((t) => t.statusId === colId).sort((a, b) => a.order - b.order);
}

function todayISO() {
  return iso(new Date());
}

function sprintStatus(s) {
  const today = todayISO();
  if (s.end && s.end < today) return "encerrado";
  if (s.start && s.start > today) return "futuro";
  return "vigente";
}

function shell() {
  return `
    <div class="app">
      <header class="top">
        <div class="brand"><strong>Mesa</strong><span>projetos pessoais</span></div>
        <nav class="nav">
          ${navBtn("kanban", "Kanban")}
          ${navBtn("lista", "Lista")}
          ${navBtn("gantt", "Gantt")}
          ${navBtn("tempo", "Tempo")}
          ${navBtn("projetos", "Projetos")}
          ${navBtn("sprints", "Sprints")}
          ${navBtn("ajustes", "Ajustes")}
        </nav>
        ${timerPill()}
      </header>
      ${viewBody()}
      <p class="foot">Os dados ficam neste navegador. Em Ajustes dá para exportar um backup.</p>
      ${drawer()}
    </div>`;
}

function navBtn(id, label) {
  return `<button data-act="nav" data-view="${id}" class="${ui.view === id ? "active" : ""}">${label}</button>`;
}

function timerPill() {
  if (!state.timer) return "";
  const t = task(state.timer.taskId);
  const sec = Math.floor((Date.now() - state.timer.startedAt) / 1000);
  return `<div class="timer-pill">
    <span>${esc(t?.title || "Tarefa")}</span>
    <b id="live-timer">${fmtHMS(sec)}</b>
    <button class="btn primary" data-act="stop-timer">Parar</button>
  </div>`;
}

function filters() {
  const projects = state.projects.map((p) => `<option value="${p.id}" ${ui.projectId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const sprints = state.sprints.map((s) => `<option value="${s.id}" ${ui.sprintId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  return `<div class="toolbar">
    <div class="seg">
      <button data-act="nav" data-view="kanban" class="${ui.view === "kanban" ? "active" : ""}">Kanban</button>
      <button data-act="nav" data-view="lista" class="${ui.view === "lista" ? "active" : ""}">Lista</button>
      <button data-act="nav" data-view="gantt" class="${ui.view === "gantt" ? "active" : ""}">Gantt</button>
    </div>
    <input id="q" class="search grow" placeholder="Código, título ou tag" value="${esc(ui.q)}">
    <select id="filter-project" class="field" style="width:auto">
      <option value="">Todos os projetos</option>${projects}
    </select>
    <select id="filter-sprint" class="field" style="width:auto">
      <option value="">Todos os sprints</option>
      <option value="none" ${ui.sprintId === "none" ? "selected" : ""}>Fora de sprint</option>
      ${sprints}
    </select>
    <label class="inline muted"><input id="hide-done" type="checkbox" ${ui.hideDone ? "checked" : ""}> Ocultar concluídas</label>
    <button class="btn primary" data-act="new-task">Nova tarefa</button>
  </div>`;
}

function viewBody() {
  if (ui.view === "kanban" || ui.view === "lista" || ui.view === "gantt") {
    return filters() + ({ kanban: kanban, lista: lista, gantt: ganttView }[ui.view])();
  }
  if (ui.view === "tempo") return tempoView();
  if (ui.view === "projetos") return projetosView();
  if (ui.view === "sprints") return sprintsView();
  return ajustesView();
}

function card(t) {
  const p = project(t.projectId);
  const doneSubs = (t.subtasks || []).filter((s) => s.done).length;
  const subs = (t.subtasks || []).length;
  return `<article class="card" draggable="true" data-task="${t.id}" data-act="open-task" data-id="${t.id}">
    <div class="card-top">
      <span class="badge">${esc(t.type || "Tarefa")}</span>
      <span class="badge ${esc(t.priority)}">${esc(priorityLabel(t.priority))}</span>
    </div>
    <h3>${esc(t.title)}</h3>
    <div class="tags">
      <span class="tag">${esc(t.code)}</span>
      ${p ? `<span class="tag"><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</span>` : ""}
      ${(t.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}
    </div>
    <div class="card-foot">
      <span>${fmtHM(logged(t.id))} / ${fmtHM(t.estimateMin)}</span>
      <span>${subs ? `${doneSubs}/${subs}` : ""}</span>
    </div>
  </article>`;
}

function kanban() {
  if (!state.tasks.length) {
    return `<div class="panel"><div class="empty">Nenhuma tarefa ainda. Crie a primeira ou <button class="btn" data-act="seed">carregue um exemplo</button>.</div></div>`;
  }
  return `<div class="board">${state.columns.map((col) => {
    const items = tasksIn(col.id);
    const est = items.reduce((a, t) => a + (t.estimateMin || 0), 0);
    const rep = items.reduce((a, t) => a + logged(t.id), 0);
    return `<section class="col" data-col="${col.id}">
      <div class="col-head">
        <div><h2>${esc(col.name)} <span class="muted">${items.length}</span></h2>
        <div class="meta">Estimado ${fmtHM(est)} · Reportado ${fmtHM(rep)}</div></div>
        <button class="icon-btn" data-act="new-task" data-status="${col.id}" title="Nova tarefa aqui">+</button>
      </div>
      <div class="cards">${items.map(card).join("") || `<div class="empty">Arraste tarefas para cá</div>`}</div>
    </section>`;
  }).join("")}</div>`;
}

function lista() {
  const rows = state.columns.map((col) => {
    const items = tasksIn(col.id);
    if (!items.length) return "";
    const head = `<tr class="group"><td colspan="8">${esc(col.name)} · ${items.length}</td></tr>`;
    const body = items.map((t) => `<tr>
      <td class="muted">${esc(t.code)}</td>
      <td><button class="link ${isDone(t) ? "struck" : ""}" data-act="open-task" data-id="${t.id}">${esc(t.title)}</button></td>
      <td>${esc(project(t.projectId)?.name || "—")}</td>
      <td>${esc(t.type || "—")}</td>
      <td><span class="badge ${esc(t.priority)}">${esc(priorityLabel(t.priority))}</span></td>
      <td>${fmtHM(logged(t.id))} / ${fmtHM(t.estimateMin)}</td>
      <td>${fmtDate(t.due)}</td>
      <td>${esc(sprint(t.sprintId)?.name || "—")}</td>
    </tr>`).join("");
    return head + body;
  }).join("");
  if (!rows) return `<div class="panel"><div class="empty">Nada para listar com esses filtros.</div></div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>
    <th>Código</th><th>Tarefa</th><th>Projeto</th><th>Tipo</th><th>Prioridade</th><th>Rep. / Est.</th><th>Prazo</th><th>Sprint</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function periodDays() {
  if (ui.ganttMode === "week") {
    const start = startOfWeek(ui.ganttAnchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const start = startOfMonth(ui.ganttAnchor);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const n = daysBetween(start, next);
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

function ganttView() {
  const days = periodDays();
  const today = todayISO();
  const head = days.map((d) => {
    const key = iso(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    return `<div class="day ${key === today ? "today" : ""} ${weekend ? "weekend" : ""}">${d.getDate()}<br>${["D", "S", "T", "Q", "Q", "S", "S"][d.getDay()]}</div>`;
  }).join("");
  const dated = [];
  const undated = [];
  visibleTasks().forEach((t) => ((t.start || t.due) ? dated : undated).push(t));
  const rows = dated.map((t) => {
    const a = parseISO(t.start || t.due);
    const b = parseISO(t.due || t.start);
    const from = a < b ? a : b;
    const to = a < b ? b : a;
    const viewStart = days[0];
    const viewEnd = days[days.length - 1];
    if (to < viewStart || from > viewEnd) return "";
    const left = Math.max(0, daysBetween(viewStart, from)) / days.length * 100;
    const right = Math.min(days.length - 1, daysBetween(viewStart, to));
    const width = (right - Math.max(0, daysBetween(viewStart, from)) + 1) / days.length * 100;
    const late = t.due && t.due < today && !isDone(t);
    const cls = isDone(t) ? "done" : late ? "late" : "";
    const color = cls ? "" : `background:${project(t.projectId)?.color || "#d7b07a"};color:#1a140d`;
    return `<div class="gantt-row">
      <div class="gantt-label"><button data-act="open-task" data-id="${t.id}">${esc(t.title)}</button><div class="meta">${esc(t.code)}</div></div>
      <div class="track"><div class="bar ${cls}" style="left:${left}%;width:${width}%;${color}">${esc(fmtDate(t.start || t.due))}</div></div>
    </div>`;
  }).join("");
  const label = ui.ganttMode === "week"
    ? fmtLong(iso(days[0])) + " – " + fmtLong(iso(days[6]))
    : ui.ganttAnchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return `
    <div class="toolbar" style="padding-top:0">
      <div class="seg">
        <button data-act="gantt-mode" data-mode="week" class="${ui.ganttMode === "week" ? "active" : ""}">Semana</button>
        <button data-act="gantt-mode" data-mode="month" class="${ui.ganttMode === "month" ? "active" : ""}">Mês</button>
      </div>
      <button class="btn" data-act="gantt-prev">←</button>
      <strong style="text-transform:capitalize">${esc(label)}</strong>
      <button class="btn" data-act="gantt-next">→</button>
      <button class="btn" data-act="gantt-today">Hoje</button>
    </div>
    <div class="legend">
      <span><i class="swatch" style="background:#d7b07a"></i>No prazo</span>
      <span><i class="swatch" style="background:#e08b78"></i>Atrasada</span>
      <span><i class="swatch" style="background:#8fbfa8"></i>Concluída</span>
    </div>
    <div class="gantt">
      <div class="gantt-head"><div class="gantt-label">Tarefa</div><div class="days" style="grid-template-columns:repeat(${days.length},1fr)">${head}</div></div>
      ${rows || `<div class="empty">Nenhuma tarefa com datas neste período.</div>`}
    </div>
    <div class="panel"><h3>Sem datas · ${undated.length}</h3>
      ${undated.map((t) => `<button class="btn" data-act="open-task" data-id="${t.id}">${esc(t.code)} ${esc(t.title)}</button>`).join(" ") || `<p class="muted">Todas as tarefas visíveis têm início ou prazo.</p>`}
    </div>`;
}

function tempoView() {
  const anchor = parseISO(ui.timeDay);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const weekCards = days.map((d) => {
    const key = iso(d);
    const min = state.entries.filter((e) => e.date === key).reduce((a, e) => a + e.minutes, 0);
    return `<button class="day-card ${key === ui.timeDay ? "active" : ""}" data-act="time-day" data-day="${key}">
      <span class="meta">${fmtLong(key)}</span><b>${fmtHM(min)}</b>
    </button>`;
  }).join("");
  const dayEntries = state.entries.filter((e) => e.date === ui.timeDay);
  const total = dayEntries.reduce((a, e) => a + e.minutes, 0);
  const byProject = {};
  dayEntries.forEach((e) => {
    const name = project(task(e.taskId)?.projectId)?.name || "Sem projeto";
    byProject[name] = (byProject[name] || 0) + e.minutes;
  });
  const options = state.tasks.map((t) => `<option value="${t.id}">${esc(t.code)} · ${esc(t.title)}</option>`).join("");
  return `<div class="panel">
    <div class="inline" style="justify-content:space-between">
      <h2 style="margin:0;font-family:Georgia,serif">${esc(fmtLong(ui.timeDay))}</h2>
      <div class="inline">
        <button class="btn" data-act="time-prev">←</button>
        <button class="btn" data-act="time-today">Hoje</button>
        <button class="btn" data-act="time-next">→</button>
      </div>
    </div>
    <p class="muted">Total do dia <b style="color:var(--text)">${fmtHM(total)}</b> · ${dayEntries.length} lançamento(s)</p>
    <div class="week">${weekCards}</div>
    <div class="grid-2">
      <div>
        <h3>Lançamentos</h3>
        ${dayEntries.map((e) => {
          const t = task(e.taskId);
          return `<div class="comment inline" style="justify-content:space-between">
            <div><b>${fmtHM(e.minutes)}</b> ${esc(t?.title || "Tarefa removida")}<div class="meta">${esc(e.note || "")}</div></div>
            <button class="btn danger" data-act="del-entry" data-id="${e.id}">Excluir</button>
          </div>`;
        }).join("") || `<div class="empty">Nenhum apontamento neste dia.</div>`}
      </div>
      <div class="stack">
        <h3>Lançar tempo</h3>
        ${state.tasks.length ? `<label>Tarefa<select id="entry-task" class="field">${options}</select></label>
          <label>Duração<input id="entry-min" class="field" placeholder="1:30 ou 1,5"></label>
          <label>Nota<input id="entry-note" class="field" placeholder="O que foi feito"></label>
          <button class="btn primary" data-act="add-entry">Adicionar</button>` : `<p class="muted">Crie uma tarefa antes de lançar tempo.</p>`}
        <h3>Por projeto</h3>
        ${Object.entries(byProject).map(([n, m]) => `<div class="inline" style="justify-content:space-between"><span>${esc(n)}</span><b>${fmtHM(m)}</b></div>`).join("") || `<p class="muted">Nada neste dia.</p>`}
      </div>
    </div>
  </div>`;
}

function projetosView() {
  const cards = state.projects.map((p) => {
    const tasks = state.tasks.filter((t) => t.projectId === p.id);
    const done = tasks.filter(isDone).length;
    const est = tasks.reduce((a, t) => a + (t.estimateMin || 0), 0);
    const rep = tasks.reduce((a, t) => a + logged(t.id), 0);
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    return `<article class="project">
      <div class="inline" style="justify-content:space-between"><span class="tag">${esc(p.code)}</span><span class="badge">${esc(p.status)}</span></div>
      <h3><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</h3>
      <p class="muted">${esc(p.description || "Sem descrição.")}</p>
      <div class="barline"><span style="width:${pct}%;background:${esc(p.color)}"></span></div>
      <div class="meta">${done}/${tasks.length} tarefas · ${fmtHM(rep)} / ${fmtHM(est)}</div>
      <div class="inline" style="margin-top:10px">
        <button class="btn" data-act="filter-project" data-id="${p.id}">Ver tarefas</button>
        <button class="btn danger" data-act="del-project" data-id="${p.id}">Excluir</button>
      </div>
    </article>`;
  }).join("");
  return `<div class="panel">
    <div class="inline" style="justify-content:space-between"><h2 style="margin:0;font-family:Georgia,serif">Projetos</h2></div>
    <div class="form-grid" style="margin:12px 0">
      <label class="span-2">Nome<input id="proj-name" class="field" placeholder="Ex.: Estudos, Casa, Leitura"></label>
      <label class="span-2">Descrição<textarea id="proj-desc" class="field" placeholder="Para que existe este projeto"></textarea></label>
      <button class="btn primary" data-act="new-project">Criar projeto</button>
    </div>
    <div class="card-list">${cards || `<div class="empty">Nenhum projeto. Tarefas também podem ficar soltas, sem projeto.</div>`}</div>
  </div>`;
}

function sprintsView() {
  const groups = ["vigente", "futuro", "encerrado"];
  const labels = { vigente: "Vigentes", futuro: "Próximos", encerrado: "Encerrados" };
  const blocks = groups.map((g) => {
    const items = state.sprints.filter((s) => sprintStatus(s) === g);
    return `<h3>${labels[g]} · ${items.length}</h3>` + (items.map((s) => {
      const n = state.tasks.filter((t) => t.sprintId === s.id).length;
      return `<div class="comment"><b>${esc(s.name)}</b> <span class="meta">${esc(s.code)} · ${fmtDate(s.start)} – ${fmtDate(s.end)} · ${n} tarefas</span>
        <div>${esc(s.goal || "")}</div>
        <button class="btn danger" data-act="del-sprint" data-id="${s.id}">Excluir</button></div>`;
    }).join("") || `<p class="muted">Nenhum.</p>`);
  }).join("");
  const monday = iso(addDays(startOfWeek(new Date()), 7));
  const sunday = iso(addDays(parseISO(monday), 6));
  return `<div class="panel">
    <h2 style="font-family:Georgia,serif">Sprints</h2>
    <p class="muted">Um sprint é só um intervalo nomeado para agrupar tarefas. O código sai da semana.</p>
    <div class="form-grid">
      <label>Nome<input id="spr-name" class="field" placeholder="Semana de foco"></label>
      <label>Objetivo<input id="spr-goal" class="field" placeholder="O que precisa sair pronto"></label>
      <label>Início<input id="spr-start" class="field" type="date" value="${monday}"></label>
      <label>Fim<input id="spr-end" class="field" type="date" value="${sunday}"></label>
      <button class="btn primary" data-act="new-sprint">Criar sprint</button>
    </div>
    ${blocks}
  </div>`;
}

function ajustesView() {
  const cols = state.columns.map((c, i) => `<div class="comment inline" style="justify-content:space-between">
    <input class="field" style="max-width:220px" data-col-name="${c.id}" value="${esc(c.name)}">
    <select class="field" style="width:auto" data-col-kind="${c.id}">
      <option value="start" ${c.kind === "start" ? "selected" : ""}>Inicial</option>
      <option value="wait" ${c.kind === "wait" ? "selected" : ""}>Fluxo</option>
      <option value="done" ${c.kind === "done" ? "selected" : ""}>Concluída</option>
    </select>
    <span>
      <button class="btn" data-act="col-up" data-id="${c.id}" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="btn" data-act="col-down" data-id="${c.id}" ${i === state.columns.length - 1 ? "disabled" : ""}>↓</button>
      <button class="btn danger" data-act="col-del" data-id="${c.id}">Excluir</button>
    </span>
  </div>`).join("");
  const types = state.types.map((t) => `<span class="tag">${esc(t)} <button data-act="del-type" data-type="${esc(t)}" style="background:none;border:0;color:var(--red)">×</button></span>`).join(" ");
  return `<div class="panel stack">
    <h2 style="font-family:Georgia,serif;margin-bottom:0">Ajustes</h2>
    <p class="muted">A coluna é o status. A inicial recebe a tarefa nova. A concluída marca o trabalho como feito.</p>
    <h3>Colunas</h3>
    ${cols}
    <div class="inline"><input id="new-col" class="field" placeholder="Nova coluna"><button class="btn" data-act="add-col">Adicionar</button></div>
    <h3>Tipos de tarefa</h3>
    <div class="tags">${types}</div>
    <div class="inline"><input id="new-type" class="field" placeholder="Novo tipo"><button class="btn" data-act="add-type">Adicionar</button></div>
    <h3>Backup</h3>
    <div class="inline">
      <button class="btn" data-act="export">Exportar JSON</button>
      <button class="btn" data-act="import-pick">Importar JSON</button>
      <input id="import-file" type="file" accept="application/json" hidden>
      <button class="btn danger" data-act="clear">Apagar tudo neste navegador</button>
    </div>
    ${state.tasks.length ? "" : `<button class="btn" data-act="seed">Carregar um exemplo para ver as visões</button>`}
  </div>`;
}

function priorityLabel(p) {
  return { baixa: "Baixa", media: "Média", alta: "Alta" }[p] || "Média";
}

function drawer() {
  const t = task(ui.openId);
  if (!t) return "";
  const projOpts = `<option value="">Sem projeto</option>` + state.projects.map((p) => `<option value="${p.id}" ${t.projectId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const statusOpts = state.columns.map((c) => `<option value="${c.id}" ${t.statusId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const typeOpts = state.types.map((n) => `<option ${t.type === n ? "selected" : ""}>${esc(n)}</option>`).join("");
  const sprOpts = `<option value="">Fora de sprint</option>` + state.sprints.map((s) => `<option value="${s.id}" ${t.sprintId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const subs = (t.subtasks || []).map((s) => `<label class="check"><input type="checkbox" data-act="toggle-sub" data-id="${s.id}" ${s.done ? "checked" : ""}><span class="${s.done ? "struck" : ""}">${esc(s.title)}</span>
    <button class="btn danger" data-act="del-sub" data-id="${s.id}">×</button></label>`).join("");
  const comments = (t.comments || []).map((c) => `<div class="comment"><div>${esc(c.text)}</div><div class="meta">${esc(c.at)}</div></div>`).join("") || `<p class="muted">Ainda não há comentários.</p>`;
  const times = state.entries.filter((e) => e.taskId === t.id).map((e) => `<div class="meta">${fmtDate(e.date)} · ${fmtHM(e.minutes)} ${esc(e.note || "")}</div>`).join("") || `<p class="muted">Nenhum apontamento nesta tarefa.</p>`;
  const running = state.timer?.taskId === t.id;
  return `<div class="drawer-back" data-act="close-drawer"></div>
    <aside class="drawer">
      <div class="inline" style="justify-content:space-between">
        <span class="tag">${esc(t.code)}</span>
        <button class="btn" data-act="close-drawer">Fechar</button>
      </div>
      <input id="f-title" class="field" style="font-size:20px;margin:10px 0" value="${esc(t.title)}">
      <div class="inline" style="justify-content:space-between">
        <b>${fmtHM(logged(t.id))} / ${fmtHM(t.estimateMin)}</b>
        ${running ? `<button class="btn primary" data-act="stop-timer">Parar timer</button>` : `<button class="btn" data-act="start-timer" data-id="${t.id}">Iniciar timer</button>`}
      </div>
      <div class="form-grid" style="margin-top:12px">
        <label>Status<select id="f-status" class="field">${statusOpts}</select></label>
        <label>Prioridade<select id="f-priority" class="field">
          <option value="baixa" ${t.priority === "baixa" ? "selected" : ""}>Baixa</option>
          <option value="media" ${t.priority === "media" ? "selected" : ""}>Média</option>
          <option value="alta" ${t.priority === "alta" ? "selected" : ""}>Alta</option>
        </select></label>
        <label>Projeto<select id="f-project" class="field">${projOpts}</select></label>
        <label>Tipo<select id="f-type" class="field">${typeOpts}</select></label>
        <label>Sprint<select id="f-sprint" class="field">${sprOpts}</select></label>
        <label>Estimativa<input id="f-estimate" class="field" value="${esc(fmtHM(t.estimateMin))}" placeholder="HH:MM"></label>
        <label>Início<input id="f-start" class="field" type="date" value="${esc(t.start || "")}"></label>
        <label>Prazo<input id="f-due" class="field" type="date" value="${esc(t.due || "")}"></label>
        <label class="span-2">Tags<input id="f-tags" class="field" value="${esc((t.tags || []).join(", "))}" placeholder="separadas por vírgula"></label>
        <label class="span-2">Descrição<textarea id="f-desc" class="field">${esc(t.description || "")}</textarea></label>
      </div>
      <h3>Subtarefas</h3>
      ${subs || `<p class="muted">Nenhuma subtarefa.</p>`}
      <div class="inline"><input id="new-sub" class="field" placeholder="Nova subtarefa"><button class="btn" data-act="add-sub">Adicionar</button></div>
      <h3>Tempo · ${fmtHM(logged(t.id))} registrado</h3>
      ${times}
      <div class="inline"><input id="f-entry" class="field" placeholder="0:30 hoje"><button class="btn" data-act="add-entry-task">Lançar</button></div>
      <h3>Comentários</h3>
      ${comments}
      <div class="inline"><input id="new-comment" class="field" placeholder="Escrever um comentário"><button class="btn" data-act="add-comment">Enviar</button></div>
      <hr class="sep">
      <button class="btn danger" data-act="del-task" data-id="${t.id}">Excluir tarefa</button>
      <p class="meta">Criada em ${esc(t.createdAt)}</p>
    </aside>`;
}

function render() {
  const active = document.activeElement;
  const aid = active && active.id;
  const start = active && active.selectionStart;
  const end = active && active.selectionEnd;
  document.getElementById("app").innerHTML = shell();
  if (ui.focus) {
    const el = document.getElementById(ui.focus);
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
    ui.focus = null;
    return;
  }
  if (aid) {
    const el = document.getElementById(aid);
    if (el) {
      el.focus();
      if (typeof start === "number" && el.setSelectionRange) {
        try { el.setSelectionRange(start, end); } catch { /* date inputs */ }
      }
    }
  }
}

function createTask(statusId) {
  const col = statusId || startColumn().id;
  const t = {
    id: uid(),
    code: `T-${String(state.seq.task).padStart(3, "0")}`,
    title: "Nova tarefa",
    description: "",
    projectId: ui.projectId || "",
    statusId: col,
    type: state.types[0] || "Tarefa",
    priority: "media",
    tags: [],
    estimateMin: 0,
    start: "",
    due: "",
    sprintId: ui.sprintId && ui.sprintId !== "none" ? ui.sprintId : "",
    subtasks: [],
    comments: [],
    order: Date.now(),
    createdAt: new Date().toLocaleString("pt-BR"),
  };
  state.seq.task += 1;
  state.tasks.push(t);
  ui.openId = t.id;
  ui.focus = "f-title";
  save();
  render();
}

function readDrawer() {
  const t = task(ui.openId);
  if (!t) return;
  const title = document.getElementById("f-title");
  if (!title) return;
  t.title = title.value.trim() || "Sem título";
  t.statusId = document.getElementById("f-status").value;
  t.priority = document.getElementById("f-priority").value;
  t.projectId = document.getElementById("f-project").value;
  t.type = document.getElementById("f-type").value;
  t.sprintId = document.getElementById("f-sprint").value;
  t.start = document.getElementById("f-start").value;
  t.due = document.getElementById("f-due").value;
  t.description = document.getElementById("f-desc").value;
  t.tags = document.getElementById("f-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
  const est = parseHM(document.getElementById("f-estimate").value);
  if (est != null) t.estimateMin = est;
}

function stopTimer() {
  if (!state.timer) return;
  const seconds = (Date.now() - state.timer.startedAt) / 1000;
  if (seconds >= 15) {
    state.entries.push({
      id: uid(),
      taskId: state.timer.taskId,
      date: todayISO(),
      minutes: Math.max(1, Math.round(seconds / 60)),
      note: "Timer",
    });
  }
  state.timer = null;
  save();
}

function seed() {
  const p1 = { id: uid(), code: "P-001", name: "Pessoal", description: "Coisas fora do expediente.", color: COLORS[0], status: "ativo" };
  const p2 = { id: uid(), code: "P-002", name: "Estudos", description: "Leitura e revisão no meu ritmo.", color: COLORS[1], status: "ativo" };
  const start = iso(new Date());
  const end = iso(addDays(new Date(), 6));
  const sp = { id: uid(), code: "S-001", name: "Esta semana", goal: "Fechar duas coisas pequenas.", start, end };
  state.projects = [p1, p2];
  state.sprints = [sp];
  state.seq = { task: 4, project: 3, sprint: 2 };
  const fazer = state.columns.find((c) => c.kind === "wait")?.id || state.columns[1].id;
  const fazendo = state.columns[2]?.id || fazer;
  state.tasks = [
    {
      id: uid(), code: "T-001", title: "Organizar a semana", description: "Escolher o que realmente entra nos próximos dias.",
      projectId: p1.id, statusId: fazer, type: "Pessoal", priority: "alta", tags: ["foco"],
      estimateMin: 60, start, due: iso(addDays(new Date(), 2)), sprintId: sp.id,
      subtasks: [{ id: uid(), title: "Olhar a agenda", done: true }, { id: uid(), title: "Escolher 3 tarefas", done: false }],
      comments: [], order: 1, createdAt: new Date().toLocaleString("pt-BR"),
    },
    {
      id: uid(), code: "T-002", title: "Ler 20 páginas", description: "",
      projectId: p2.id, statusId: startColumn().id, type: "Ideia", priority: "baixa", tags: ["leitura"],
      estimateMin: 45, start: "", due: "", sprintId: "",
      subtasks: [], comments: [], order: 2, createdAt: new Date().toLocaleString("pt-BR"),
    },
    {
      id: uid(), code: "T-003", title: "Revisar um tema", description: "Uma sessão curta, com nota do que ficou.",
      projectId: p2.id, statusId: fazendo, type: "Tarefa", priority: "media", tags: ["estudo"],
      estimateMin: 90, start, due: iso(addDays(new Date(), 4)), sprintId: sp.id,
      subtasks: [], comments: [], order: 3, createdAt: new Date().toLocaleString("pt-BR"),
    },
  ];
  state.entries = [{ id: uid(), taskId: state.tasks[2].id, date: start, minutes: 25, note: "Primeira sessão" }];
  save();
  ui.view = "kanban";
  render();
}

function onClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (ui.openId && act !== "close-drawer" && act !== "toggle-sub") readDrawer();
  if (act === "open-task" && e.target.closest("button, a, input")) {
    if (el.dataset.act === "open-task" && el.tagName !== "BUTTON" && el.tagName !== "ARTICLE") return;
  }
  if (act === "nav") {
    ui.view = el.dataset.view;
    render();
    return;
  }
  if (act === "new-task") {
    createTask(el.dataset.status);
    return;
  }
  if (act === "open-task") {
    ui.openId = el.dataset.id || el.dataset.task;
    render();
    return;
  }
  if (act === "close-drawer") {
    if (e.target !== el && !e.target.closest("[data-act='close-drawer']")) return;
    readDrawer();
    ui.openId = null;
    save();
    render();
    return;
  }
  if (act === "start-timer") {
    stopTimer();
    state.timer = { taskId: el.dataset.id, startedAt: Date.now() };
    save();
    render();
    return;
  }
  if (act === "stop-timer") {
    stopTimer();
    render();
    return;
  }
  if (act === "del-task") {
    if (!confirm("Excluir esta tarefa e os tempos dela?")) return;
    state.tasks = state.tasks.filter((t) => t.id !== el.dataset.id);
    state.entries = state.entries.filter((en) => en.taskId !== el.dataset.id);
    if (state.timer?.taskId === el.dataset.id) state.timer = null;
    ui.openId = null;
    save();
    render();
    return;
  }
  if (act === "toggle-sub") {
    const t = task(ui.openId);
    const s = t?.subtasks.find((x) => x.id === el.dataset.id);
    if (s) s.done = el.checked;
    save();
    return;
  }
  if (act === "del-sub") {
    const t = task(ui.openId);
    t.subtasks = t.subtasks.filter((s) => s.id !== el.dataset.id);
    save();
    render();
    return;
  }
  if (act === "add-sub") {
    const input = document.getElementById("new-sub");
    const title = input.value.trim();
    if (!title) return;
    task(ui.openId).subtasks.push({ id: uid(), title, done: false });
    save();
    render();
    return;
  }
  if (act === "add-comment") {
    const input = document.getElementById("new-comment");
    const text = input.value.trim();
    if (!text) return;
    task(ui.openId).comments.push({ id: uid(), text, at: new Date().toLocaleString("pt-BR") });
    save();
    render();
    return;
  }
  if (act === "add-entry-task") {
    const minutes = parseHM(document.getElementById("f-entry").value);
    if (minutes == null || minutes <= 0) return;
    state.entries.push({ id: uid(), taskId: ui.openId, date: todayISO(), minutes, note: "" });
    save();
    render();
    return;
  }
  if (act === "add-entry") {
    const minutes = parseHM(document.getElementById("entry-min").value);
    const taskId = document.getElementById("entry-task").value;
    if (!taskId || minutes == null || minutes <= 0) return;
    state.entries.push({
      id: uid(), taskId, date: ui.timeDay, minutes,
      note: document.getElementById("entry-note").value.trim(),
    });
    save();
    render();
    return;
  }
  if (act === "del-entry") {
    state.entries = state.entries.filter((en) => en.id !== el.dataset.id);
    save();
    render();
    return;
  }
  if (act === "new-project") {
    const name = document.getElementById("proj-name").value.trim();
    if (!name) return;
    state.projects.push({
      id: uid(),
      code: `P-${String(state.seq.project).padStart(3, "0")}`,
      name,
      description: document.getElementById("proj-desc").value.trim(),
      color: COLORS[state.projects.length % COLORS.length],
      status: "ativo",
    });
    state.seq.project += 1;
    save();
    render();
    return;
  }
  if (act === "del-project") {
    if (!confirm("Excluir o projeto? As tarefas continuam, soltas.")) return;
    state.projects = state.projects.filter((p) => p.id !== el.dataset.id);
    state.tasks.forEach((t) => { if (t.projectId === el.dataset.id) t.projectId = ""; });
    save();
    render();
    return;
  }
  if (act === "filter-project") {
    ui.projectId = el.dataset.id;
    ui.view = "kanban";
    render();
    return;
  }
  if (act === "new-sprint") {
    const name = document.getElementById("spr-name").value.trim();
    const start = document.getElementById("spr-start").value;
    const end = document.getElementById("spr-end").value;
    if (!name || !start || !end) return;
    const week = weekNumber(parseISO(start));
    state.sprints.push({
      id: uid(),
      code: `S-${parseISO(start).getFullYear()}-W${week}`,
      name,
      goal: document.getElementById("spr-goal").value.trim(),
      start, end,
    });
    state.seq.sprint += 1;
    save();
    render();
    return;
  }
  if (act === "del-sprint") {
    state.sprints = state.sprints.filter((s) => s.id !== el.dataset.id);
    state.tasks.forEach((t) => { if (t.sprintId === el.dataset.id) t.sprintId = ""; });
    save();
    render();
    return;
  }
  if (act === "gantt-mode") {
    ui.ganttMode = el.dataset.mode;
    ui.ganttAnchor = ui.ganttMode === "week" ? startOfWeek(ui.ganttAnchor) : startOfMonth(ui.ganttAnchor);
    render();
    return;
  }
  if (act === "gantt-prev" || act === "gantt-next") {
    const dir = act === "gantt-next" ? 1 : -1;
    if (ui.ganttMode === "week") ui.ganttAnchor = addDays(ui.ganttAnchor, 7 * dir);
    else ui.ganttAnchor = new Date(ui.ganttAnchor.getFullYear(), ui.ganttAnchor.getMonth() + dir, 1);
    render();
    return;
  }
  if (act === "gantt-today") {
    ui.ganttAnchor = ui.ganttMode === "week" ? startOfWeek(new Date()) : startOfMonth(new Date());
    render();
    return;
  }
  if (act === "time-day") {
    ui.timeDay = el.dataset.day;
    render();
    return;
  }
  if (act === "time-prev" || act === "time-next") {
    ui.timeDay = iso(addDays(parseISO(ui.timeDay), act === "time-next" ? 1 : -1));
    render();
    return;
  }
  if (act === "time-today") {
    ui.timeDay = todayISO();
    render();
    return;
  }
  if (act === "add-col") {
    const name = document.getElementById("new-col").value.trim();
    if (!name) return;
    state.columns.push({ id: uid(), name, kind: "wait" });
    save();
    render();
    return;
  }
  if (act === "col-up" || act === "col-down") {
    const i = state.columns.findIndex((c) => c.id === el.dataset.id);
    const j = act === "col-up" ? i - 1 : i + 1;
    if (j < 0 || j >= state.columns.length) return;
    const [item] = state.columns.splice(i, 1);
    state.columns.splice(j, 0, item);
    save();
    render();
    return;
  }
  if (act === "col-del") {
    const used = state.tasks.some((t) => t.statusId === el.dataset.id);
    if (used) {
      alert("Esta coluna tem tarefas. Mova elas antes de excluir.");
      return;
    }
    if (state.columns.length === 1) return;
    state.columns = state.columns.filter((c) => c.id !== el.dataset.id);
    if (!state.columns.some((c) => c.kind === "start")) state.columns[0].kind = "start";
    save();
    render();
    return;
  }
  if (act === "add-type") {
    const name = document.getElementById("new-type").value.trim();
    if (!name || state.types.includes(name)) return;
    state.types.push(name);
    save();
    render();
    return;
  }
  if (act === "del-type") {
    const name = el.dataset.type;
    if (state.tasks.some((t) => t.type === name)) {
      alert("Há tarefas com este tipo. Ele fica no histórico.");
      return;
    }
    state.types = state.types.filter((t) => t !== name);
    save();
    render();
    return;
  }
  if (act === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mesa-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  if (act === "import-pick") {
    document.getElementById("import-file").click();
    return;
  }
  if (act === "clear") {
    if (!confirm("Apagar projetos, tarefas e tempos deste navegador?")) return;
    state = defaultState();
    ui.openId = null;
    save();
    render();
    return;
  }
  if (act === "seed") seed();
}

function weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, "0");
}

const app = document.getElementById("app");
app.addEventListener("click", (e) => {
  if (dragged) {
    dragged = false;
    return;
  }
  if (e.target.closest(".card") && e.target.closest("button, input, a")) return;
  onClick(e);
});
app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "filter-project") { ui.projectId = t.value; render(); return; }
  if (t.id === "filter-sprint") { ui.sprintId = t.value; render(); return; }
  if (t.id === "hide-done") { ui.hideDone = t.checked; render(); return; }
  if (t.id === "import-file" && t.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.tasks || !data.columns) throw new Error("arquivo incompleto");
        state = { ...defaultState(), ...data };
        ui.openId = null;
        save();
        render();
      } catch {
        alert("Não consegui ler esse JSON.");
      }
      t.value = "";
    };
    reader.readAsText(t.files[0]);
    return;
  }
  if (t.dataset.colKind) {
    const col = column(t.dataset.colKind);
    col.kind = t.value;
    if (t.value === "start") state.columns.forEach((c) => { if (c.id !== col.id && c.kind === "start") c.kind = "wait"; });
    save();
    return;
  }
  if (ui.openId && t.id && t.id.startsWith("f-")) {
    readDrawer();
    save();
    if (t.id !== "f-title" && t.id !== "f-desc" && t.id !== "f-tags" && t.id !== "f-estimate") render();
  }
});
app.addEventListener("blur", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.colName) {
    const col = column(t.dataset.colName);
    if (col && t.value.trim()) { col.name = t.value.trim(); save(); }
    return;
  }
  if (ui.openId && t.id && ["f-title", "f-desc", "f-tags", "f-estimate"].includes(t.id)) {
    readDrawer();
    save();
  }
}, true);
app.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    ui.q = e.target.value;
    render();
  }
});
app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "new-sub") { e.preventDefault(); onClick({ target: document.querySelector("[data-act=add-sub]") }); }
  if (e.key === "Enter" && e.target.id === "new-comment") { e.preventDefault(); onClick({ target: document.querySelector("[data-act=add-comment]") }); }
  if (e.key === "Escape" && ui.openId) {
    readDrawer();
    ui.openId = null;
    save();
    render();
  }
});
app.addEventListener("dragstart", (e) => {
  const cardEl = e.target.closest("[data-task]");
  if (!cardEl) return;
  dragged = true;
  e.dataTransfer.setData("text/plain", cardEl.dataset.task);
  e.dataTransfer.effectAllowed = "move";
});
app.addEventListener("dragend", () => {
  setTimeout(() => { dragged = false; }, 0);
});
app.addEventListener("dragover", (e) => {
  const col = e.target.closest("[data-col]");
  if (!col) return;
  e.preventDefault();
  col.classList.add("drop");
});
app.addEventListener("dragleave", (e) => {
  const col = e.target.closest("[data-col]");
  if (col) col.classList.remove("drop");
});
app.addEventListener("drop", (e) => {
  const col = e.target.closest("[data-col]");
  if (!col) return;
  e.preventDefault();
  const t = task(e.dataTransfer.getData("text/plain"));
  if (!t) return;
  t.statusId = col.dataset.col;
  t.order = Date.now();
  save();
  render();
});

setInterval(() => {
  const el = document.getElementById("live-timer");
  if (el && state.timer) el.textContent = fmtHMS((Date.now() - state.timer.startedAt) / 1000);
}, 1000);

render();
