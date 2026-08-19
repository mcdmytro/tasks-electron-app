const URGENCY = ["High", "Medium", "Low"];
const RANK = { High: 3, Medium: 2, Low: 1 };

let tasks = [];
let pages = [{ id: "life", name: "Life" }];
let currentPageId = "life";
let openId = null;
let showAllSteps = false;
let loaded = false;

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// Electron doesn't implement window.prompt() — it silently does nothing.
// This builds a small in-page modal instead, styled to match the rest of the app.
function showPromptModal(title, placeholder) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <p class="modal-title">${escapeHtml(title)}</p>
        <input type="text" id="modal-input" placeholder="${escapeAttr(placeholder || "")}" />
        <div class="modal-actions">
          <button class="btn primary" id="modal-ok">OK</button>
          <button class="btn" id="modal-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#modal-input");
    input.focus();

    function cleanup(value) {
      document.body.removeChild(overlay);
      resolve(value);
    }
    overlay.querySelector("#modal-ok").addEventListener("click", () => cleanup(input.value));
    overlay.querySelector("#modal-cancel").addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cleanup(input.value);
      if (e.key === "Escape") cleanup(null);
    });
  });
}

async function persist() {
  await window.taskAPI.save({ tasks, pages, currentPageId });
}

async function init() {
  const data = await window.taskAPI.load();
  tasks = data.tasks;
  pages = data.pages;
  currentPageId = data.currentPageId;
  loaded = true;
  renderPageTabs();
  renderList();
}

// ---------- Pages ----------
function setCurrentPage(id) {
  currentPageId = id;
  persist();
  renderPageTabs();
  renderList();
}

function renderPageTabs() {
  const el = document.getElementById("page-tabs");
  el.innerHTML = pages.map(p => `
    <button class="page-tab ${p.id === currentPageId ? "active" : ""}" data-page-id="${p.id}">
      ${escapeHtml(p.name)}
      ${pages.length > 1 ? `<span class="page-tab-delete" data-delete-page-id="${p.id}" aria-label="Delete page">&times;</span>` : ""}
    </button>
  `).join("") + `<button class="page-tab add" id="add-page-btn" aria-label="Add page">+</button>`;

  el.querySelectorAll("[data-page-id]").forEach(btn => {
    btn.addEventListener("click", () => setCurrentPage(btn.dataset.pageId));
  });
  el.querySelectorAll("[data-delete-page-id]").forEach(span => {
    span.addEventListener("click", (e) => {
      e.stopPropagation(); // don't also trigger the tab's own select handler
      deletePage(span.dataset.deletePageId);
    });
  });
  document.getElementById("add-page-btn").addEventListener("click", async () => {
    const name = await showPromptModal("Name for the new page:", "e.g. Health, Errands");
    if (!name || !name.trim()) return;
    await pushBackup();
    const id = uid();
    pages.push({ id, name: name.trim() });
    persist();
    setCurrentPage(id);
  });
}

async function deletePage(id) {
  if (pages.length <= 1) return; // always keep at least one page
  const page = pages.find(p => p.id === id);
  if (!page) return;
  const affected = tasks.filter(t => t.pageId === id).length;
  const msg = affected > 0
    ? `Delete "${page.name}"? ${affected} task${affected === 1 ? "" : "s"} on this page will be moved to another page, not deleted.`
    : `Delete "${page.name}"?`;
  if (!confirm(msg)) return;
  await pushBackup();

  pages = pages.filter(p => p.id !== id);
  const fallbackId = pages[0].id;
  tasks.forEach(t => { if (t.pageId === id) t.pageId = fallbackId; });
  if (currentPageId === id) currentPageId = fallbackId;

  await persist();
  renderPageTabs();
  renderList();
}

// ---------- Backups ----------
async function pushBackup() {
  await window.taskAPI.pushBackup({ tasks, pages });
}

async function renderBackupsPanel() {
  const panel = document.getElementById("backups-panel");
  const backups = await window.taskAPI.listBackups();
  if (!backups.length) {
    panel.innerHTML = `<div class="form-card"><p class="empty">No backups yet — they're created automatically when you add, delete, or edit a task.</p></div>`;
    return;
  }
  panel.innerHTML = `<div class="form-card">
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">Automatic snapshots, most recent first. Restoring replaces your current tasks and pages.</p>
    ${[...backups].reverse().map((b, i) => {
      const realIndex = backups.length - 1 - i;
      const taskCount = b.tasks.length;
      const pageCount = Array.isArray(b.pages) ? b.pages.length : null;
      const label = pageCount !== null
        ? `${taskCount} task${taskCount === 1 ? "" : "s"}, ${pageCount} page${pageCount === 1 ? "" : "s"}`
        : `${taskCount} task${taskCount === 1 ? "" : "s"}`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;">${new Date(b.timestamp).toLocaleString()} — ${label}</span>
        <button class="btn" data-restore-index="${realIndex}">Restore</button>
      </div>`;
    }).join("")}
  </div>`;
  panel.querySelectorAll("[data-restore-index]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.restoreIndex);
      const list = await window.taskAPI.listBackups();
      const b = list[idx];
      if (!b) return;
      if (!confirm(`Restore the backup from ${new Date(b.timestamp).toLocaleString()}? This replaces your current tasks and pages.`)) return;
      tasks = b.tasks;
      if (Array.isArray(b.pages) && b.pages.length) pages = b.pages; // older backups may not have pages saved
      if (!pages.find(p => p.id === currentPageId)) currentPageId = pages[0].id;
      await persist();
      document.getElementById("backups-panel").classList.add("hidden");
      renderPageTabs();
      renderList();
    });
  });
}

// ---------- Steps parsing/serializing ----------
function parseStepsText(text, oldSteps) {
  const pool = [];
  (oldSteps || []).forEach(s => {
    pool.push({ text: s.text, checked: s.checked, pending: !!s.pending, used: false });
    (s.subSteps || []).forEach(sub => pool.push({ text: sub.text, checked: sub.checked, pending: false, used: false }));
  });
  function takeState(t) {
    const m = pool.find(p => !p.used && p.text === t);
    if (m) { m.used = true; return { checked: m.checked, pending: m.pending }; }
    return { checked: false, pending: false };
  }
  const steps = [];
  let current = null;
  text.split("\n").forEach(raw => {
    if (!raw.trim()) return;
    const isSub = /^\s*[-*]\s+/.test(raw);
    const content = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (isSub && current) {
      const state = takeState(content);
      current.subSteps.push({ id: uid(), text: content, checked: state.checked });
    } else {
      const state = takeState(raw.trim());
      current = { id: uid(), text: raw.trim(), checked: state.checked, pending: state.pending, subSteps: [] };
      steps.push(current);
    }
  });
  return steps;
}

function serializeSteps(steps) {
  return steps.map(s => {
    const subLines = (s.subSteps || []).map(sub => "- " + sub.text);
    return [s.text, ...subLines].join("\n");
  }).join("\n");
}

// ---------- Board / list ----------
function sortedTasks() {
  return [...tasks].sort((a, b) => {
    const r = (RANK[b.urgency] || 0) - (RANK[a.urgency] || 0);
    if (r !== 0) return r;
    return (a.dueDate || "").localeCompare(b.dueDate || "");
  });
}

function taskCardHtml(t) {
  const next = t.steps.find(s => !s.checked);
  const cls = t.urgency || "none";
  const multiHint = next && next.subSteps && next.subSteps.length > 1 ? " (multiple sub-steps)" : "";
  const label = next ? (next.pending ? "Pending step" : "Next step") : "";
  return `
    <div class="task-row" data-id="${t.id}">
      <div class="row-top">
        <span class="badge ${cls}">${t.urgency || "No urgency"}</span>
        <span class="row-meta">${t.dueDate || ""}</span>
      </div>
      <div class="row-title">${escapeHtml(t.title)}</div>
      ${next ? `<div class="progress${next.pending ? " pending" : ""}">${label}: ${escapeHtml(next.text)}${multiHint}</div>` : (t.steps.length ? `<div class="progress">All steps complete</div>` : "")}
    </div>`;
}

function renderList() {
  const el = document.getElementById("task-list");
  const all = sortedTasks().filter(t => t.pageId === currentPageId);

  if (all.length === 0) {
    el.innerHTML = '<p class="empty">No tasks yet. Add your first one above.</p>';
    return;
  }

  el.innerHTML = `
    <div class="board">
      ${URGENCY.map(u => {
        const colTasks = all.filter(t => t.urgency === u);
        return `
          <div class="board-col">
            <p class="board-col-title">${u}</p>
            ${colTasks.length ? colTasks.map(taskCardHtml).join("") : '<p class="empty">Nothing here</p>'}
          </div>`;
      }).join("")}
    </div>
  `;

  el.querySelectorAll(".task-row").forEach(row => {
    row.addEventListener("click", () => openTask(row.dataset.id));
  });
}

// ---------- Card view ----------
function openTask(id) {
  openId = id;
  showAllSteps = false;
  document.querySelector(".page").classList.add("narrow");
  document.getElementById("list-view").classList.add("hidden");
  document.getElementById("card-view").classList.remove("hidden");
  renderCard();
}

function backToList() {
  document.querySelector(".page").classList.remove("narrow");
  document.getElementById("card-view").classList.add("hidden");
  document.getElementById("list-view").classList.remove("hidden");
  renderList();
}

function renderCard() {
  const task = tasks.find(t => t.id === openId);
  const steps = task.steps;
  const currentIndex = steps.findIndex(s => !s.checked);
  const prev = currentIndex > 0 ? steps[currentIndex - 1] : null;
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const next = (currentIndex >= 0 && currentIndex < steps.length - 1) ? steps[currentIndex + 1] : null;
  const cls = task.urgency || "none";

  const revertStep = currentIndex === -1
    ? (steps.length ? steps[steps.length - 1] : null)
    : (currentIndex > 0 ? steps[currentIndex - 1] : null);

  const pickerHtml = current ? `
      <div class="step-adjacent">${prev ? escapeHtml(prev.text) : ""}</div>
      ${current.pending ? `<p class="pending-label">Pending</p>` : ""}
      <div class="step-current">${escapeHtml(current.text)}</div>
      <div class="step-adjacent">${next ? escapeHtml(next.text) : ""}</div>
      ${current.subSteps && current.subSteps.length ? `
        <ul class="sub-steps-inline">
          ${current.subSteps.map(sub => `
            <li data-sub-id="${sub.id}" data-parent-id="${current.id}" class="${sub.checked ? "checked" : ""}">
              <span class="checkbox ${sub.checked ? "on" : ""}">${sub.checked ? "&#10003;" : ""}</span>
              ${escapeHtml(sub.text)}
            </li>`).join("")}
        </ul>` : ""}
    ` : `<p class="step-done">All steps complete</p>`;

  document.getElementById("task-card").innerHTML = `
    <div class="card">
      <div class="row-top">
        <span class="badge ${cls}">${task.urgency || "No urgency"}</span>
        <span class="row-meta">${task.dueDate || ""}</span>
      </div>
      <h2>${escapeHtml(task.title)}</h2>
      <div class="step-picker">${pickerHtml}</div>
      <div class="card-actions">
        ${current ? `<button class="btn primary" id="mark-done-btn">Mark step done</button>` : ""}
        ${current ? `<button class="btn pending" id="mark-pending-btn">${current.pending ? "Unmark pending" : "Mark as pending"}</button>` : ""}
        ${revertStep ? `<button class="btn" id="return-prev-btn">Return to previous step</button>` : ""}
      </div>
      <div class="card-actions">
        <button class="btn" id="toggle-all-btn">${showAllSteps ? "Hide" : "Show"} all steps</button>
        <button class="btn" id="edit-task-btn">Edit</button>
      </div>
      <div id="edit-task-form"></div>
      ${showAllSteps ? `
        <ul class="all-steps">
          ${steps.map(s => `
            <li data-step-id="${s.id}" class="${s.checked ? "checked" : ""}">
              <span class="checkbox ${s.checked ? "on" : ""}">${s.checked ? "&#10003;" : ""}</span>
              ${escapeHtml(s.text)}${s.pending && !s.checked ? ` <span class="pending-tag">pending</span>` : ""}
            </li>
            ${(s.subSteps || []).map(sub => `
              <li data-sub-id="${sub.id}" data-parent-id="${s.id}" class="sub-step ${sub.checked ? "checked" : ""}">
                <span class="checkbox ${sub.checked ? "on" : ""}">${sub.checked ? "&#10003;" : ""}</span>
                ${escapeHtml(sub.text)}
              </li>`).join("")}
          `).join("")}
        </ul>` : ""}
      <button class="delete-btn" id="delete-task-btn">Delete task</button>
    </div>
  `;

  if (current) {
    document.getElementById("mark-done-btn").addEventListener("click", () => {
      current.checked = true;
      current.pending = false;
      (current.subSteps || []).forEach(sub => sub.checked = true);
      persist();
      renderCard();
    });
    document.getElementById("mark-pending-btn").addEventListener("click", () => {
      current.pending = !current.pending;
      persist();
      renderCard();
    });
  }
  if (revertStep) {
    document.getElementById("return-prev-btn").addEventListener("click", () => {
      revertStep.checked = false;
      revertStep.pending = false;
      (revertStep.subSteps || []).forEach(sub => sub.checked = false);
      persist();
      renderCard();
    });
  }
  document.getElementById("toggle-all-btn").addEventListener("click", () => {
    showAllSteps = !showAllSteps;
    renderCard();
  });
  document.getElementById("edit-task-btn").addEventListener("click", () => {
    renderEditForm(task);
  });
  document.querySelectorAll("[data-step-id]").forEach(li => {
    li.addEventListener("click", () => {
      const step = steps.find(s => s.id === li.dataset.stepId);
      if (!step.checked) {
        step.checked = true;
        step.pending = false;
        (step.subSteps || []).forEach(sub => sub.checked = true);
      } else {
        step.checked = false;
      }
      persist();
      renderCard();
    });
  });
  document.querySelectorAll("[data-sub-id]").forEach(li => {
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      const parent = steps.find(s => s.id === li.dataset.parentId);
      const sub = parent.subSteps.find(x => x.id === li.dataset.subId);
      sub.checked = !sub.checked;
      persist();
      renderCard();
    });
  });
  document.getElementById("delete-task-btn").addEventListener("click", async () => {
    if (!confirm(`Delete "${task.title}"? This can't be undone from within the app (though it'll still be in your automatic backups).`)) return;
    await pushBackup();
    tasks = tasks.filter(t => t.id !== openId);
    await persist();
    backToList();
  });
}

// ---------- New task form ----------
function renderNewTaskForm() {
  document.getElementById("new-task-form").innerHTML = `
    <div class="form-card">
      <div class="form-grid">
        <input id="nt-title" placeholder="Task name" />
        <div class="form-row">
          <select id="nt-urgency">
            ${URGENCY.map(u => `<option value="${u}">${u}</option>`).join("")}
          </select>
          <input id="nt-due" type="date" />
        </div>
        <textarea id="nt-steps" rows="5" placeholder="Steps, one per line. Indent with - for sub-steps:&#10;Register for the test&#10;Prepare for it&#10;- Complete test exam&#10;- Finish B1+ textbook"></textarea>
        <div class="form-actions">
          <button class="btn primary" id="nt-save">Add task</button>
          <button class="btn" id="nt-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("nt-save").addEventListener("click", async () => {
    const title = document.getElementById("nt-title").value.trim();
    if (!title) return;
    const urgency = document.getElementById("nt-urgency").value;
    const dueDate = document.getElementById("nt-due").value;
    const steps = parseStepsText(document.getElementById("nt-steps").value);
    await pushBackup();
    tasks.push({ id: uid(), title, urgency, dueDate, steps, pageId: currentPageId });
    await persist();
    document.querySelector(".page").classList.remove("narrow");
    document.getElementById("new-task-form").classList.add("hidden");
    document.getElementById("new-task-form").innerHTML = "";
    renderList();
  });
  document.getElementById("nt-cancel").addEventListener("click", () => {
    document.querySelector(".page").classList.remove("narrow");
    document.getElementById("new-task-form").classList.add("hidden");
    document.getElementById("new-task-form").innerHTML = "";
  });
}

// ---------- Edit task form ----------
function renderEditForm(task) {
  const container = document.getElementById("edit-task-form");
  container.innerHTML = `
    <div class="form-card" style="margin-top:16px;">
      <div class="form-grid">
        <input id="et-title" placeholder="Task name" value="${escapeAttr(task.title)}" />
        <div class="form-row">
          <select id="et-urgency">
            ${URGENCY.map(u => `<option value="${u}" ${u === task.urgency ? "selected" : ""}>${u}</option>`).join("")}
          </select>
          <input id="et-due" type="date" value="${task.dueDate || ""}" />
        </div>
        <textarea id="et-steps" rows="5" placeholder="Steps, one per line. Indent with - for sub-steps">${escapeHtml(serializeSteps(task.steps))}</textarea>
        <div class="form-actions">
          <button class="btn primary" id="et-save">Save changes</button>
          <button class="btn" id="et-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("et-save").addEventListener("click", async () => {
    const title = document.getElementById("et-title").value.trim();
    if (!title) return;
    const urgency = document.getElementById("et-urgency").value;
    const dueDate = document.getElementById("et-due").value;
    const newSteps = parseStepsText(document.getElementById("et-steps").value, task.steps);

    await pushBackup();
    task.title = title;
    task.urgency = urgency;
    task.dueDate = dueDate;
    task.steps = newSteps;
    await persist();
    container.innerHTML = "";
    renderCard();
  });

  document.getElementById("et-cancel").addEventListener("click", () => {
    container.innerHTML = "";
  });
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Wiring ----------
document.getElementById("new-task-btn").addEventListener("click", () => {
  document.querySelector(".page").classList.add("narrow");
  const form = document.getElementById("new-task-form");
  form.classList.remove("hidden");
  renderNewTaskForm();
});
document.getElementById("back-btn").addEventListener("click", backToList);
document.getElementById("backups-btn").addEventListener("click", async () => {
  const panel = document.getElementById("backups-panel");
  const willShow = panel.classList.contains("hidden");
  if (willShow) await renderBackupsPanel();
  panel.classList.toggle("hidden", !willShow);
});

init();