// =============================================
//  TaskFlow – Main Application Logic
// =============================================

const DB_KEY = 'taskflow_data';
const THEME_KEY = 'taskflow_theme';
const COLOR_THEME_KEY = 'taskflow_color_theme';
const LAYOUT_MODE_KEY = 'taskflow_layout_mode';
const STREAK_KEY = 'taskflow_streak';

// =============================================
//  State
// =============================================
let tasks = [];
let currentFilter = { category: 'all', status: 'all', search: '' };
let editingTaskId = null;
let activeView = 'tasks';
let isGridMode = false;

// =============================================
//  Data Persistence
// =============================================
function saveData() {
  localStorage.setItem(DB_KEY, JSON.stringify(tasks));
}

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch (e) {
    tasks = [];
  }
}

// =============================================
//  Streak Logic
// =============================================
function getStreakData() {
  try {
    return JSON.parse(localStorage.getItem(STREAK_KEY)) || { days: 0, lastDate: null };
  } catch { return { days: 0, lastDate: null }; }
}

function updateStreak() {
  const today = new Date().toDateString();
  const data = getStreakData();
  const todayTasks = tasks.filter(t => isToday(t.createdAt));
  const todayCompleted = todayTasks.filter(t => t.completed).length;

  if (todayTasks.length > 0 && todayCompleted === todayTasks.length) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (data.lastDate === yesterday.toDateString()) {
      data.days += 1;
    } else if (data.lastDate !== today) {
      data.days = 1;
    }
    data.lastDate = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(data));
  }
  return data.days;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr).toDateString() === new Date().toDateString();
}

// =============================================
//  Greeting & Motivational Quote
// =============================================
function updateGreeting() {
  const hour = new Date().getHours();
  const greetings = {
    morning: '☀️ صباح الخير!',
    afternoon: '🌤️ مساء النور!',
    evening: '🌙 مساء الخير!',
    night: '🌃 تصبح على خير!'
  };
  let greeting;
  if (hour >= 5 && hour < 12) greeting = greetings.morning;
  else if (hour >= 12 && hour < 17) greeting = greetings.afternoon;
  else if (hour >= 17 && hour < 21) greeting = greetings.evening;
  else greeting = greetings.night;

  const greetingEl = document.getElementById('greeting-text');
  if (greetingEl) greetingEl.textContent = greeting;

  const now = new Date();
  const dateOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateEl = document.getElementById('date-text');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('ar-EG', dateOpts);

  const quotes = [
    "خطوة واحدة صغيرة كل يوم تصنع فارقاً كبيراً! 🚀",
    "النجاح هو مجموع المحاولات الصغيرة اليومية! 💪",
    "الانضباط هو الجسر بين الأهداف والإنجازات! ✨",
    "ركّز على إنجاز مهام اليوم وبث السرور في نفسك! 🌟"
  ];
  const quoteEl = document.getElementById('quote-text');
  if (quoteEl) {
    quoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];
  }
}

// =============================================
//  Progress Ring & Dashboard Stats
// =============================================
function updateProgressUI() {
  const todayAll = tasks.filter(t => isToday(t.createdAt));
  const todayDone = todayAll.filter(t => t.completed);
  const allCount = todayAll.length;
  const doneCount = todayDone.length;
  const pct = allCount === 0 ? 0 : Math.round((doneCount / allCount) * 100);

  const todaySummaryEl = document.getElementById('today-summary');
  if (todaySummaryEl) todaySummaryEl.textContent = `${doneCount} / ${allCount}`;

  const progressValEl = document.getElementById('progress-value');
  if (progressValEl) progressValEl.textContent = `${pct}%`;

  const circle = document.getElementById('progress-circle');
  if (circle) {
    const circumference = 2 * Math.PI * 19; // r=19
    const offset = circumference * (1 - pct / 100);
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
  }

  const streak = updateStreak();
  const streakEl = document.getElementById('streak-count');
  if (streakEl) streakEl.textContent = `${streak} ${streak === 1 ? 'يوم' : 'أيام'}`;

  // Quick summary chips
  const pendingCount = tasks.filter(t => !t.completed).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const urgentCount = tasks.filter(t => !t.completed && t.priority === 'high').length;

  const pendingEl = document.getElementById('pending-chip-count');
  if (pendingEl) pendingEl.textContent = pendingCount;

  const completedEl = document.getElementById('completed-chip-count');
  if (completedEl) completedEl.textContent = completedCount;

  const urgentEl = document.getElementById('urgent-chip-count');
  if (urgentEl) urgentEl.textContent = urgentCount;
}

// =============================================
//  Category Labels
// =============================================
const categoryMap = {
  work: { label: 'عمل', icon: '💼' },
  personal: { label: 'شخصي', icon: '👤' },
  study: { label: 'دراسة', icon: '📚' },
  health: { label: 'صحة', icon: '🏋️' },
  shopping: { label: 'تسوق', icon: '🛒' },
};

const priorityMap = {
  high: { label: 'عالية', icon: '🔥', cls: 'priority-high' },
  medium: { label: 'متوسطة', icon: '⚡', cls: 'priority-medium' },
  low: { label: 'منخفضة', icon: '☕', cls: 'priority-low' },
};

// =============================================
//  Render Tasks
// =============================================
function getFilteredTasks() {
  return tasks.filter(task => {
    const matchCat = currentFilter.category === 'all' || task.category === currentFilter.category;
    let matchStatus = true;
    if (currentFilter.status === 'completed') matchStatus = task.completed;
    else if (currentFilter.status === 'pending') matchStatus = !task.completed;
    
    if (activeView === 'today') {
      matchStatus = matchStatus && isToday(task.createdAt);
    }

    const q = currentFilter.search.trim().toLowerCase();
    const matchSearch = !q || task.title.toLowerCase().includes(q) || (task.description || '').toLowerCase().includes(q);
    return matchCat && matchStatus && matchSearch;
  }).sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pOrder = { high: 0, medium: 1, low: 2 };
    if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function renderTasks() {
  const list = document.getElementById('tasks-list');
  if (!list) return;
  const filtered = getFilteredTasks();

  list.classList.toggle('grid-mode', isGridMode);

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <h3>لا توجد مهام ${activeView === 'today' ? 'اليوم' : ''}</h3>
        <p>اضغط على زر + أو اختر من الإضافة السريعة أعلاه 🚀</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(task => createTaskCard(task)).join('');

  // Attach events after rendering
  list.querySelectorAll('.custom-checkbox').forEach(cb => {
    cb.addEventListener('click', () => toggleTask(cb.dataset.id));
  });
  list.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(btn.dataset.id); });
  });
  list.querySelectorAll('.task-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  list.querySelectorAll('.task-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
  });

  updateProgressUI();
}

function createTaskCard(task) {
  const cat = categoryMap[task.category] || { label: task.category, icon: '📌' };
  const prio = priorityMap[task.priority] || priorityMap.medium;

  const subtasksDone = (task.subtasks || []).filter(s => s.done).length;
  const subtasksTotal = (task.subtasks || []).length;
  const subPct = subtasksTotal > 0 ? Math.round((subtasksDone / subtasksTotal) * 100) : 0;

  const dueText = task.dueDate
    ? `<span class="due-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg> ${formatDue(task.dueDate)}</span>`
    : '';

  const subtasksBar = subtasksTotal > 0 ? `
    <div class="subtasks-bar-container">
      <div class="subtasks-bar-label">
        <span>المهام الفرعية</span>
        <span>${subtasksDone}/${subtasksTotal}</span>
      </div>
      <div class="subtasks-progress">
        <div class="subtasks-progress-fill" style="width:${subPct}%"></div>
      </div>
    </div>` : '';

  return `
    <div class="task-card ${task.completed ? 'completed' : ''}" id="task-${task.id}">
      <div class="task-header">
        <div class="custom-checkbox ${task.completed ? 'checked' : ''}" data-id="${task.id}" role="checkbox" aria-checked="${task.completed}" tabindex="0">
          ${task.completed ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
        <div class="task-body">
          <div class="task-title">${escapeHtml(task.title)}</div>
          ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
          <div class="task-tags">
            <span class="tag-badge ${prio.cls}">${prio.icon} ${prio.label}</span>
            <span class="tag-badge category">${cat.icon} ${cat.label}</span>
            ${dueText}
          </div>
          ${subtasksBar}
        </div>
        <div class="task-actions">
          <button class="action-icon-btn task-detail-btn" data-id="${task.id}" title="التفاصيل" aria-label="تفاصيل">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </button>
          <button class="action-icon-btn task-edit-btn" data-id="${task.id}" title="تعديل" aria-label="تعديل">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-icon-btn delete task-delete-btn" data-id="${task.id}" title="حذف" aria-label="حذف">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function formatDue(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = d - now;
  if (diff < 0) return `⚠️ متأخرة`;
  return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// =============================================
//  Toggle Task / Subtask
// =============================================
function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) {
    playCompleteSound();
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    showToast('✅ مهمة مكتملة! عمل رائع!', 'success');
    checkAllDone();
  }
  saveData();
  renderTasks();
}

function toggleSubtask(taskId, subIdx) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.subtasks[subIdx]) return;
  task.subtasks[subIdx].done = !task.subtasks[subIdx].done;
  saveData();
  renderTasks();
}

function checkAllDone() {
  const todayAll = tasks.filter(t => isToday(t.createdAt));
  if (todayAll.length > 0 && todayAll.every(t => t.completed)) {
    setTimeout(() => {
      launchConfetti();
      showToast('🎉 أنجزت جميع مهام اليوم! رائع!', 'success');
    }, 300);
  }
}

// =============================================
//  CRUD
// =============================================
function addTask(data) {
  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title: data.title.trim(),
    description: (data.description || '').trim(),
    category: data.category || 'personal',
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: (data.subtasks || []).filter(s => s.text && s.text.trim()).map(s => ({ text: s.text.trim(), done: false })),
  };
  tasks.unshift(task);
  saveData();
  renderTasks();
  showToast('➕ تمت إضافة المهمة بنجاح!', 'info');
}

function updateTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  tasks[idx] = {
    ...tasks[idx],
    title: data.title.trim(),
    description: (data.description || '').trim(),
    category: data.category,
    priority: data.priority,
    dueDate: data.dueDate || null,
    subtasks: (data.subtasks || []).filter(s => s.text && s.text.trim()).map(s => ({ text: s.text.trim(), done: false })),
  };
  saveData();
  renderTasks();
  showToast('✏️ تم تحديث المهمة!', 'info');
}

function deleteTask(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المهمة؟')) return;
  tasks = tasks.filter(t => t.id !== id);
  saveData();
  renderTasks();
  showToast('🗑️ تم حذف المهمة', 'info');
}

// =============================================
//  Modal: Add / Edit
// =============================================
function openAddModal() {
  editingTaskId = null;
  document.getElementById('modal-title').textContent = 'إضافة مهمة جديدة';
  document.getElementById('form-submit-btn').textContent = '✅ حفظ المهمة';
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  document.getElementById('subtasks-input-list').innerHTML = `
    <div class="subtask-input-item">
      <input type="text" class="form-control subtask-input" placeholder="مهمة فرعية 1..." />
      <button type="button" class="action-icon-btn delete" onclick="this.parentElement.remove()" aria-label="حذف">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.getElementById('task-modal').classList.add('open');
  setTimeout(() => document.getElementById('task-title-input').focus(), 400);
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;

  document.getElementById('modal-title').textContent = 'تعديل المهمة';
  document.getElementById('form-submit-btn').textContent = '💾 حفظ التعديلات';
  document.getElementById('task-id').value = id;
  document.getElementById('task-title-input').value = task.title;
  document.getElementById('task-desc-input').value = task.description || '';
  document.getElementById('task-date-input').value = task.dueDate || '';
  document.getElementById('task-category-input').value = task.category;
  document.querySelector(`input[name="priority"][value="${task.priority}"]`).checked = true;

  const subList = document.getElementById('subtasks-input-list');
  subList.innerHTML = '';
  const subItems = task.subtasks && task.subtasks.length > 0 ? task.subtasks : [{ text: '' }];
  subItems.forEach(s => {
    subList.insertAdjacentHTML('beforeend', `
      <div class="subtask-input-item">
        <input type="text" class="form-control subtask-input" value="${escapeHtml(s.text)}" placeholder="مهمة فرعية..." />
        <button type="button" class="action-icon-btn delete" onclick="this.parentElement.remove()" aria-label="حذف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`);
  });

  document.getElementById('task-modal').classList.add('open');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('open');
  editingTaskId = null;
}

// =============================================
//  Modal: Task Detail
// =============================================
function openDetailModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const cat = categoryMap[task.category] || { label: task.category, icon: '📌' };
  const prio = priorityMap[task.priority] || priorityMap.medium;

  let subtasksHtml = '';
  if (task.subtasks && task.subtasks.length > 0) {
    subtasksHtml = `<div style="margin-top:16px">
      <p style="font-size:0.82rem;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">المهام الفرعية</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${task.subtasks.map((s, i) => `
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" class="subtask-check" data-task-id="${task.id}" data-sub-idx="${i}" ${s.done ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary)"/>
            <span style="${s.done ? 'text-decoration:line-through;opacity:0.5' : ''}">${escapeHtml(s.text)}</span>
          </label>`).join('')}
      </div>
    </div>`;
  }

  document.getElementById('detail-content').innerHTML = `
    <div>
      <h3 style="font-size:1.15rem;font-weight:700;margin-bottom:8px;color:var(--text-main)">${escapeHtml(task.title)}</h3>
      ${task.description ? `<p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5">${escapeHtml(task.description)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <span class="tag-badge ${prio.cls}">${prio.icon} ${prio.label}</span>
        <span class="tag-badge category">${cat.icon} ${cat.label}</span>
        <span class="tag-badge category">${task.completed ? '✅ مكتملة' : '⏳ قيد التنفيذ'}</span>
      </div>
      ${task.dueDate ? `<p style="font-size:0.82rem;color:var(--text-muted)">📅 الموعد: ${formatDue(task.dueDate)}</p>` : ''}
      <p style="font-size:0.78rem;color:var(--text-muted);margin-top:6px">🕐 أُنشئت: ${new Date(task.createdAt).toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric'})}</p>
      ${subtasksHtml}
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn-primary" onclick="toggleTask('${task.id}');closeDetailModal()" style="flex:1;padding:12px;">
          ${task.completed ? '↩️ إلغاء الإنجاز' : '✅ تحديد كمنجزة'}
        </button>
        <button onclick="closeDetailModal();openEditModal('${task.id}')" style="flex:1;padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-solid);color:var(--text-main);font-weight:600;cursor:pointer">
          ✏️ تعديل
        </button>
      </div>
    </div>`;

  document.getElementById('detail-modal').classList.add('open');

  document.querySelectorAll('.subtask-check').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleSubtask(cb.dataset.taskId, parseInt(cb.dataset.subIdx));
      openDetailModal(id);
    });
  });
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.remove('open');
}

// =============================================
//  Stats View
// =============================================
function renderStats() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;
  const streak = getStreakData().days;

  const statsEl = document.getElementById('stats-grid');
  statsEl.innerHTML = [
    { label: 'إجمالي المهام', value: total, icon: '📋', color: 'var(--primary)' },
    { label: 'مكتملة', value: completed, icon: '✅', color: 'var(--success)' },
    { label: 'قيد التنفيذ', value: pending, icon: '⏳', color: 'var(--warning)' },
    { label: 'سلسلة الإنجاز', value: `${streak} 🔥`, icon: '🔥', color: 'var(--accent)' },
  ].map(s => `
    <div style="background:var(--surface-solid);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;text-align:center;box-shadow:var(--shadow-sm)">
      <div style="font-size:2rem;margin-bottom:6px">${s.icon}</div>
      <div style="font-size:1.5rem;font-weight:800;color:${s.color};margin-bottom:4px">${s.value}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);font-weight:600">${s.label}</div>
    </div>`).join('');

  // Category Breakdown
  const catBreakdown = document.getElementById('category-breakdown');
  const catCounts = {};
  tasks.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
  catBreakdown.innerHTML = `
    <p style="font-size:0.85rem;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">التوزيع حسب التصنيف</p>
    ${Object.entries(catCounts).map(([cat, count]) => {
      const c = categoryMap[cat] || { label: cat, icon: '📌' };
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-bottom:6px">
          <span>${c.icon} ${c.label}</span><span style="font-weight:700">${count} (${pct}%)</span>
        </div>
        <div style="height:7px;background:var(--surface-hover);border-radius:999px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--primary);transition:width 0.5s ease;border-radius:999px"></div>
        </div>
      </div>`;
    }).join('')}`;
}

// =============================================
//  View Management
// =============================================
function showView(view) {
  activeView = view;
  const mainContent = document.querySelector('.app-content');
  const statsView = document.getElementById('stats-view');
  const settingsView = document.getElementById('settings-view');
  const fab = document.getElementById('fab-btn');

  mainContent.style.display = 'none';
  statsView.style.display = 'none';
  settingsView.style.display = 'none';

  if (view === 'stats') {
    statsView.style.display = 'block';
    fab.style.display = 'none';
    renderStats();
  } else if (view === 'settings') {
    settingsView.style.display = 'block';
    fab.style.display = 'none';
  } else {
    mainContent.style.display = 'block';
    fab.style.display = 'flex';
    renderTasks();
  }
}

// =============================================
//  Sound Effects (Web Audio API)
// =============================================
function playCompleteSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.35);
    });
  } catch (e) { /* Audio not supported */ }
}

// =============================================
//  Confetti
// =============================================
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  const particles = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -10,
    vx: (Math.random() - 0.5) * 4,
    vy: Math.random() * 5 + 2,
    size: Math.random() * 9 + 4,
    color: ['#0d9488', '#2dd4bf', '#a855f7', '#fb923c', '#10b981', '#3b82f6', '#ec4899'][Math.floor(Math.random() * 7)],
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 6,
  }));

  let frame;
  let elapsed = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
      ctx.restore();
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotV;
      p.vy += 0.08;
    });
    elapsed++;
    if (elapsed < 150) frame = requestAnimationFrame(draw);
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  draw();
}

// =============================================
//  Toast Notifications
// =============================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  const colors = { success: '#10b981', info: '#0d9488', error: '#ef4444' };
  toast.style.borderLeftColor = colors[type] || colors.info;
  toast.style.borderLeftWidth = '4px';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// =============================================
//  Theme & Color Theme Switching
// =============================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const icon = document.getElementById('theme-icon');
  if (theme === 'dark') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}

function applyColorTheme(colorTheme) {
  document.documentElement.setAttribute('data-color-theme', colorTheme);
  localStorage.setItem(COLOR_THEME_KEY, colorTheme);

  document.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.classList.toggle('active', swatch.dataset.color === colorTheme);
  });

  const themeColors = {
    teal: '#0d9488',
    purple: '#9333ea',
    cobalt: '#2563eb',
    sunset: '#ea580c',
    emerald: '#059669'
  };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && themeColors[colorTheme]) {
    themeMeta.setAttribute('content', themeColors[colorTheme]);
  }
}

// =============================================
//  Export & Clear Tasks
// =============================================
function exportData() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
  const dlAnchor = document.createElement('a');
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `TaskFlow_Backup_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();
  showToast('📥 تم تصدير بياناتك بنجاح!', 'success');
}

function clearCompletedTasks() {
  const completedCount = tasks.filter(t => t.completed).length;
  if (completedCount === 0) {
    showToast('لا توجد مهام مكتملة لمسحها', 'info');
    return;
  }
  if (!confirm(`هل أنت متأكد من مسح ${completedCount} مهمة مكتملة؟`)) return;
  tasks = tasks.filter(t => !t.completed);
  saveData();
  renderTasks();
  showToast('🧹 تم مسح المهام المكتملة', 'info');
}

// =============================================
//  Event Listeners
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  const savedColorTheme = localStorage.getItem(COLOR_THEME_KEY) || 'teal';
  applyColorTheme(savedColorTheme);

  isGridMode = localStorage.getItem(LAYOUT_MODE_KEY) === 'true';

  updateGreeting();

  renderTasks();
  updateProgressUI();

  // Template Quick Chips Handler (1-tap add task)
  document.querySelectorAll('.template-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.template;
      const category = btn.dataset.category || 'personal';
      addTask({ title, category, priority: 'medium', description: '', subtasks: [] });
    });
  });

  // Layout Toggle Button
  const layoutBtn = document.getElementById('layout-toggle-btn');
  if (layoutBtn) {
    layoutBtn.classList.toggle('active', isGridMode);
    layoutBtn.addEventListener('click', () => {
      isGridMode = !isGridMode;
      localStorage.setItem(LAYOUT_MODE_KEY, isGridMode);
      layoutBtn.classList.toggle('active', isGridMode);
      renderTasks();
      showToast(isGridMode ? '📊 تم التبديل لعرّض الشبكة' : '📋 تم التبديل لعرّض القائمة', 'info');
    });
  }

  // FAB – Add Task
  document.getElementById('fab-btn').addEventListener('click', openAddModal);

  // Theme Toggle (Header & Settings)
  const toggleThemeHandler = () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleThemeHandler);
  document.getElementById('settings-theme-btn')?.addEventListener('click', toggleThemeHandler);

  // Color Theme Swatches
  document.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      applyColorTheme(swatch.dataset.color);
      showToast('🎨 تم تغيير ثيم الألوان!', 'info');
    });
  });

  // Export & Clear Completed Data
  document.getElementById('export-data-btn')?.addEventListener('click', exportData);
  document.getElementById('clear-completed-btn')?.addEventListener('click', clearCompletedTasks);

  // Search Toggle
  const searchBox = document.getElementById('search-box');
  document.getElementById('search-toggle-btn').addEventListener('click', () => {
    const isHidden = searchBox.style.display === 'none';
    searchBox.style.display = isHidden ? 'block' : 'none';
    if (isHidden) document.getElementById('search-input').focus();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    currentFilter.search = e.target.value;
    renderTasks();
  });

  // Category Filter
  document.getElementById('categories-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    document.querySelectorAll('[data-category]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter.category = btn.dataset.category;
    renderTasks();
  });

  // Status Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter.status = btn.dataset.status;
      renderTasks();
    });
  });

  // Bottom Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      showView(item.dataset.view);
    });
  });

  // Modal: Close
  document.getElementById('modal-close-btn').addEventListener('click', closeTaskModal);
  document.getElementById('task-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('task-modal')) closeTaskModal();
  });

  // Modal: Detail Close
  document.getElementById('detail-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target === document.target) closeDetailModal();
  });

  // Add Subtask Input
  document.getElementById('add-subtask-btn').addEventListener('click', () => {
    const count = document.querySelectorAll('.subtask-input').length + 1;
    document.getElementById('subtasks-input-list').insertAdjacentHTML('beforeend', `
      <div class="subtask-input-item">
        <input type="text" class="form-control subtask-input" placeholder="مهمة فرعية ${count}..." />
        <button type="button" class="action-icon-btn delete" onclick="this.parentElement.remove()" aria-label="حذف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`);
    document.querySelector('.subtask-input:last-of-type')?.focus();
  });

  // Form Submit
  document.getElementById('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title-input').value.trim();
    if (!title) {
      showToast('⚠️ يرجى إدخال عنوان المهمة', 'error');
      document.getElementById('task-title-input').focus();
      return;
    }

    const data = {
      title,
      description: document.getElementById('task-desc-input').value,
      category: document.getElementById('task-category-input').value,
      priority: document.querySelector('input[name="priority"][value="${task.priority}"]')?.value || 'medium',
      dueDate: document.getElementById('task-date-input').value,
      subtasks: Array.from(document.querySelectorAll('.subtask-input')).map(i => ({ text: i.value })),
    };

    if (editingTaskId) {
      updateTask(editingTaskId, data);
    } else {
      addTask(data);
    }
    closeTaskModal();
  });

  // Keyboard: close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTaskModal();
      closeDetailModal();
    }
  });
});

// =============================================
//  Service Worker Registration
// =============================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('TaskFlow SW registered'))
      .catch(err => console.warn('SW registration failed:', err));
  });
}
