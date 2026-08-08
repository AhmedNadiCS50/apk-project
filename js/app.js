// =============================================
//  TaskFlow v10 – Full Rebuild & Bug Fixes
// =============================================

const DB_KEY = 'taskflow_data';
const THEME_KEY = 'taskflow_theme';
const COLOR_THEME_KEY = 'taskflow_color_theme';
const LAYOUT_MODE_KEY = 'taskflow_layout_mode';
const STREAK_KEY = 'taskflow_streak';
const ALARM_KEY = 'taskflow_alarm_enabled';
const STICKY_NOTIF_KEY = 'taskflow_sticky_enabled';
const MEMOS_KEY = 'taskflow_voice_memos';
const SOUND_KEY = 'taskflow_sound_enabled';
const AUTO_THEME_KEY = 'taskflow_auto_theme';
const TRASH_KEY = 'taskflow_trash';
const SNAPSHOTS_KEY = 'taskflow_snapshots';
const PIN_KEY = 'taskflow_pin';

// Global State
let tasks = [];
let currentFilter = { category: 'all', status: 'all', search: '' };
let editingTaskId = null;
let activeView = 'tasks';
let isGridMode = false;
let dbInstance = null;
let alarmEnabled = false;
let stickyEnabled = false;
let soundEnabled = true;
let isAutoTheme = false;

// Timers State
let pomoSeconds = 25 * 60;
let pomoInterval = null;
let isPomoRunning = false;

let activeTimerTaskId = null;
let activeRingingTaskId = null;
let alarmAudioLoopInterval = null;

// =============================================
//  IndexedDB + LocalStorage Dual Storage Engine
// =============================================
function initIndexedDB() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const request = indexedDB.open('TaskFlowDB', 2);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trash')) {
        db.createObjectStore('trash', { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = () => resolve(null);
  });
}

function saveData() {
  localStorage.setItem(DB_KEY, JSON.stringify(tasks));
  if (dbInstance) {
    try {
      const tx = dbInstance.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      store.clear();
      tasks.forEach(t => store.put(t));
    } catch (e) {
      console.warn('IndexedDB sync warning:', e);
    }
  }
  updateDatabaseInfoUI();
  updateStorageQuotaUI();
  if (typeof updateStickyNotification === 'function') {
    updateStickyNotification();
  }
}

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch (e) {
    tasks = [];
  }

  initIndexedDB().then(db => {
    if (db && tasks.length === 0) {
      const tx = db.transaction('tasks', 'readonly');
      const store = tx.objectStore('tasks');
      const req = store.getAll();
      req.onsuccess = () => {
        if (req.result && req.result.length > 0) {
          tasks = req.result;
          saveData();
          renderTasks();
        }
      };
    }
    updateDatabaseInfoUI();
    updateStorageQuotaUI();
    purgeOldTrash();
    checkPINProtection();
  });
}

function updateDatabaseInfoUI() {
  const infoEl = document.getElementById('db-task-count-info');
  if (infoEl) {
    infoEl.textContent = `عدد المهام المحفوظة: ${tasks.length} مهمة (متزامنة في IndexedDB)`;
  }
}

function updateStorageQuotaUI() {
  const textEl = document.getElementById('storage-quota-text');
  const fillEl = document.getElementById('storage-quota-fill');
  if (!textEl || !fillEl) return;

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(estimate => {
      const usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
      const quotaGB = (estimate.quota / (1024 * 1024 * 1024)).toFixed(1);
      const pct = Math.min(100, ((estimate.usage / estimate.quota) * 100).toFixed(2));
      textEl.textContent = `${usageMB} ميجابايت مستخدمة من ${quotaGB} جيجابايت (${pct}%)`;
      fillEl.style.width = `${Math.max(2, pct)}%`;
    }).catch(() => {
      calculateFallbackQuota(textEl, fillEl);
    });
  } else {
    calculateFallbackQuota(textEl, fillEl);
  }
}

function calculateFallbackQuota(textEl, fillEl) {
  let totalChars = 0;
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      totalChars += (localStorage[key].length + key.length) * 2;
    }
  }
  const kb = (totalChars / 1024).toFixed(1);
  const pct = Math.min(100, ((totalChars / (5 * 1024 * 1024)) * 100).toFixed(1));
  textEl.textContent = `${kb} كيلوبايت مستخدمة من 5 ميجابايت (${pct}%)`;
  fillEl.style.width = `${Math.max(2, pct)}%`;
}

// =============================================
//  Alarm & Notifications System
// =============================================
function initAlarmSystem() {
  alarmEnabled = localStorage.getItem(ALARM_KEY) === 'true';
  stickyEnabled = localStorage.getItem(STICKY_NOTIF_KEY) === 'true';
  updateAlarmBtnUI();
  updateStickyBtnUI();
  setInterval(checkDueAlarmsAndTimers, 1000);
}

function updateStickyBtnUI() {
  const btn = document.getElementById('sticky-permission-btn');
  const desc = document.getElementById('sticky-status-desc');
  if (btn) {
    if (stickyEnabled) {
      btn.textContent = 'مفعّل 📌';
      btn.style.background = 'var(--primary)';
      btn.style.color = '#ffffff';
      if (desc) desc.textContent = 'إشعار مثبت مفعّل في ستارة الإشعارات 📌';
    } else {
      btn.textContent = 'تفعيل 📌';
      btn.style.background = 'var(--surface-solid)';
      btn.style.color = 'var(--text-muted)';
      if (desc) desc.textContent = 'اضغط لتثبيت إشعار دائم يوضح ملخص المهام';
    }
  }
}

function toggleStickyPermission() {
  if (!('Notification' in window)) {
    showToast('⚠️ متصفحك لا يدعم الإشعارات المباشرة', 'error');
    return;
  }

  if (Notification.permission === 'granted') {
    stickyEnabled = !stickyEnabled;
    localStorage.setItem(STICKY_NOTIF_KEY, stickyEnabled);
    updateStickyBtnUI();
    if (stickyEnabled) {
      updateStickyNotification();
      showToast('📌 تم تثبيت إشعار الملخص في ستارة الهاتف!', 'success');
    } else {
      clearStickyNotification();
      showToast('🔕 تم إلغاء الإشعار المثبت', 'info');
    }
  } else {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        stickyEnabled = true;
        localStorage.setItem(STICKY_NOTIF_KEY, 'true');
        updateStickyBtnUI();
        updateStickyNotification();
        showToast('📌 تم السماح وتثبيت إشعار الملخص!', 'success');
      } else {
        showToast('⚠️ يرجى السماح بالإشعارات من إعدادات الهاتف', 'error');
      }
    });
  }
}

// Helper: emoji progress bar
function buildProgressBar(done, total) {
  if (total === 0) return '⬜⬜⬜⬜⬜';
  const filled = Math.round((done / total) * 5);
  return '🟩'.repeat(filled) + '⬜'.repeat(5 - filled);
}

function updateStickyNotification() {
  if (!stickyEnabled || !('Notification' in window) || Notification.permission !== 'granted') {
    clearStickyNotification();
    return;
  }

  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const pending = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const progressBar = buildProgressBar(done, total);

  const bodyLines = [
    `${progressBar}  ${pct}%`,
    `✅ منجزة: ${done}   ⏳ متبقية: ${pending}`,
  ];

  const nextTask = tasks.find(t => !t.completed);
  if (nextTask) {
    const preview = nextTask.title.length > 28 ? nextTask.title.slice(0, 28) + '…' : nextTask.title;
    bodyLines.push(`▶ التالية: ${preview}`);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification('📋 TaskFlow – مهامي اليوم', {
        body: bodyLines.join('\n'),
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        image: 'icons/notification-banner.png',
        tag: 'taskflow-sticky-summary',
        renotify: false,
        requireInteraction: true,
        silent: true,
        dir: 'rtl',
        lang: 'ar',
        data: { url: './', sticky: true },
        actions: [
          { action: 'open', title: '🚀 فتح التطبيق' },
          { action: 'dismiss', title: '✖ إخفاء' }
        ]
      });
    }).catch(err => console.warn('Sticky notification error:', err));
  }
}

function clearStickyNotification() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.getNotifications({ tag: 'taskflow-sticky-summary' }).then(notifications => {
        notifications.forEach(n => n.close());
      });
    }).catch(() => {});
  }
}

function updateAlarmBtnUI() {
  const btn = document.getElementById('alarm-permission-btn');
  const desc = document.getElementById('alarm-status-desc');
  if (btn) {
    if (alarmEnabled) {
      btn.textContent = 'مفعّل 🔔';
      btn.style.background = 'var(--primary)';
      btn.style.color = '#ffffff';
      if (desc) desc.textContent = 'المنبه والإشعارات مفعّلة بنجاح 🔊';
    } else {
      btn.textContent = 'تفعيل 🔔';
      btn.style.background = 'var(--surface-solid)';
      btn.style.color = 'var(--text-muted)';
      if (desc) desc.textContent = 'اضغط للتفعيل والسماح بالتنبيهات الصوتية';
    }
  }
}

function toggleAlarmPermission() {
  if (!('Notification' in window)) {
    showToast('⚠️ متصفحك لا يدعم الإشعارات المباشرة', 'error');
    return;
  }

  if (Notification.permission === 'granted') {
    alarmEnabled = !alarmEnabled;
    localStorage.setItem(ALARM_KEY, alarmEnabled);
    updateAlarmBtnUI();
    if (alarmEnabled) {
      playAlarmRingtone();
      showToast('🔊 تم تفعيل المنبه والإشعارات الصوتية!', 'success');
    } else {
      showToast('🔕 تم إيقاف المنبه', 'info');
    }
  } else {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        alarmEnabled = true;
        localStorage.setItem(ALARM_KEY, 'true');
        updateAlarmBtnUI();
        playAlarmRingtone();
        showToast('🔊 تم السماح بالإشعارات وتفعيل المنبه!', 'success');
      } else {
        showToast('⚠️ تم رفض الإذن. يرجى السماح بالإشعارات من إعدادات الهاتف', 'error');
      }
    });
  }
}

function playAlarmRingtone() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.3, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.4);
    });
  } catch (e) { console.warn('Audio alarm sound error:', e); }
}

function checkDueAlarmsAndTimers() {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5); // "HH:MM"
  let needsSave = false;

  tasks.forEach(task => {
    if (task.completed) return;

    // 1. Check countdown timer target timestamp
    if (task.timerTargetTimestamp && !task.alarmRingTriggered) {
      const remainingMs = task.timerTargetTimestamp - now;

      const badgeEl = document.getElementById(`countdown-${task.id}`);
      if (badgeEl) {
        badgeEl.textContent = remainingMs > 0
          ? `⏱️ ${formatCountdownMs(remainingMs)}`
          : `🔔 رنّ المنبه`;
      }

      if (remainingMs <= 0) {
        task.alarmRingTriggered = true;
        needsSave = true;
        triggerTaskAlarmPopup(task);
      }
    }

    // 2. Check scheduled due time for today (only if alarmEnabled)
    if (
      alarmEnabled &&
      task.dueDate === todayStr &&
      task.dueTime &&
      task.dueTime === nowTimeStr &&
      !task.alarmRingTriggered
    ) {
      task.alarmRingTriggered = true;
      needsSave = true;
      triggerTaskAlarmPopup(task);
    }
  });

  // Batch save only if something changed to avoid unnecessary writes
  if (needsSave) saveData();
}

function formatCountdownMs(ms) {
  if (ms <= 0) return '00:00';
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
  const secs = (totalSecs % 60).toString().padStart(2, '0');
  if (hrs > 0) return `${hrs}:${mins}:${secs}`;
  return `${mins}:${secs}`;
}

function triggerTaskAlarmPopup(task) {
  activeRingingTaskId = task.id;
  const titleEl = document.getElementById('alarm-alert-task-title');
  if (titleEl) titleEl.textContent = task.title;

  const modal = document.getElementById('alarm-alert-modal');
  if (modal) modal.classList.add('open');

  startAlarmAudioLoop();

  if (navigator.vibrate) {
    navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('⏰ حان موعد المهمة!', {
      body: `المهمة: ${task.title}`,
      icon: 'icons/icon-192.png',
      tag: `task-alarm-${task.id}`,
      renotify: true
    });
  }
}

function startAlarmAudioLoop() {
  stopAlarmAudioLoop();
  playAlarmRingtone();
  alarmAudioLoopInterval = setInterval(() => {
    playAlarmRingtone();
  }, 1400);
}

function stopAlarmAudioLoop() {
  if (alarmAudioLoopInterval) {
    clearInterval(alarmAudioLoopInterval);
    alarmAudioLoopInterval = null;
  }
}

function dismissAlarmPopup(action) {
  stopAlarmAudioLoop();
  const modal = document.getElementById('alarm-alert-modal');
  if (modal) modal.classList.remove('open');

  if (action === 'done' && activeRingingTaskId) {
    toggleTask(activeRingingTaskId);
  }
  activeRingingTaskId = null;
}

// Timer Picker Modal Logic
function openTimerModal(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  activeTimerTaskId = taskId;

  const titleEl = document.getElementById('timer-task-title');
  if (titleEl) titleEl.textContent = `المهمة: "${task.title}"`;

  const cancelBtn = document.getElementById('cancel-timer-btn');
  if (cancelBtn) {
    cancelBtn.style.display = (task.timerTargetTimestamp && !task.alarmRingTriggered) ? 'block' : 'none';
  }

  const modal = document.getElementById('timer-modal');
  if (modal) modal.classList.add('open');
}

function closeTimerModal() {
  const modal = document.getElementById('timer-modal');
  if (modal) modal.classList.remove('open');
  activeTimerTaskId = null;
}

function setTaskTimer(mins) {
  if (!activeTimerTaskId || isNaN(mins) || mins <= 0) return;
  const task = tasks.find(t => t.id === activeTimerTaskId);
  if (!task) return;

  task.timerTargetTimestamp = Date.now() + mins * 60 * 1000;
  task.alarmRingTriggered = false;
  saveData();
  renderTasks();
  closeTimerModal();
  showToast(`⏱️ تم ضبط المنبه بعد ${mins} دقيقة للمهمة!`, 'success');
}

function cancelActiveTaskTimer() {
  if (!activeTimerTaskId) return;
  const task = tasks.find(t => t.id === activeTimerTaskId);
  if (!task) return;

  delete task.timerTargetTimestamp;
  delete task.alarmRingTriggered;
  saveData();
  renderTasks();
  closeTimerModal();
  showToast('🔕 تم إلغاء المؤقت', 'info');
}

// =============================================
//  Pomodoro Focus Timer
// =============================================
function updatePomoUI() {
  const mins = Math.floor(pomoSeconds / 60).toString().padStart(2, '0');
  const secs = (pomoSeconds % 60).toString().padStart(2, '0');
  const display = document.getElementById('pomo-timer-display');
  if (display) display.textContent = `${mins}:${secs}`;

  const focusDisplay = document.getElementById('focus-modal-timer-display');
  if (focusDisplay) focusDisplay.textContent = `${mins}:${secs}`;

  const startBtn = document.getElementById('pomo-start-btn');
  if (startBtn) startBtn.textContent = isPomoRunning ? '⏸️ إيقاف' : '▶️ ابدأ';

  const focusToggleBtn = document.getElementById('focus-modal-toggle-btn');
  if (focusToggleBtn) focusToggleBtn.textContent = isPomoRunning ? '⏸️ إيقاف الجلسة' : '▶️ ابدأ الجلسة';

  const pomoCard = document.querySelector('.pomo-card');
  if (pomoCard) pomoCard.classList.toggle('running', isPomoRunning);
}

function togglePomoTimer() {
  if (isPomoRunning) {
    clearInterval(pomoInterval);
    isPomoRunning = false;
  } else {
    isPomoRunning = true;
    pomoInterval = setInterval(() => {
      if (pomoSeconds > 0) {
        pomoSeconds--;
        updatePomoUI();
      } else {
        clearInterval(pomoInterval);
        isPomoRunning = false;
        playAlarmRingtone();
        launchConfetti();
        showToast('🎉 انتهت جلسة التركيز! خذ استراحة 5 دقائق', 'success');
        pomoSeconds = 25 * 60;
        updatePomoUI();
      }
    }, 1000);
  }
  updatePomoUI();
}

function resetPomoTimer() {
  clearInterval(pomoInterval);
  isPomoRunning = false;
  pomoSeconds = 25 * 60;
  updatePomoUI();
}

// =============================================
//  Voice Speech Input
// =============================================
function startVoiceRecognition(targetInputId) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('⚠️ الإدخال الصوتي غير مدعوم في هذا المتصفح', 'error');
    return;
  }

  const recognition = new SpeechRec();
  recognition.lang = 'ar-EG';
  recognition.interimResults = false;

  const btn = document.getElementById('voice-input-btn');
  if (btn) btn.classList.add('listening');
  showToast('🎙️ استمع الآن... تكلّم بعنصر المهمة', 'info');

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if (text) {
      if (targetInputId === 'task-title-input') {
        document.getElementById('task-title-input').value = text;
      } else {
        openAddModal();
        setTimeout(() => {
          document.getElementById('task-title-input').value = text;
        }, 300);
      }
      showToast(`🎤 تم التقاط النص: "${text}"`, 'success');
    }
  };

  recognition.onerror = () => {
    showToast('⚠️ لم يتم سماع الصوت بوضوح، حاول مجدداً', 'error');
  };

  recognition.onend = () => {
    if (btn) btn.classList.remove('listening');
  };

  recognition.start();
}

// =============================================
//  Streak & Helper Functions
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
    const circumference = 2 * Math.PI * 19;
    const offset = circumference * (1 - pct / 100);
    circle.setAttribute('stroke-dasharray', circumference.toFixed(1));
    circle.setAttribute('stroke-dashoffset', offset.toFixed(1));
  }

  const streak = updateStreak();
  const streakEl = document.getElementById('streak-count');
  if (streakEl) streakEl.textContent = streak;

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

function getFilteredTasks() {
  return tasks.filter(task => {
    const matchCat = currentFilter.category === 'all' || task.category === currentFilter.category;
    let matchStatus = true;
    if (currentFilter.status === 'completed') matchStatus = task.completed;
    else if (currentFilter.status === 'pending') matchStatus = !task.completed;

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
        <p>اضغط على زر + أو استخدم الميكروفون للإضافة الصوتيّة 🎤</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(task => createTaskCard(task)).join('');

  list.querySelectorAll('.custom-checkbox').forEach(cb => {
    cb.addEventListener('click', () => toggleTask(cb.dataset.id));
  });
  list.querySelectorAll('.task-timer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openTimerModal(btn.dataset.id); });
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

  // Inline Subtasks Toggle
  list.querySelectorAll('.inline-subtasks-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const container = document.getElementById(`subtasks-container-${btn.dataset.id}`);
      if (container) container.classList.toggle('open');
    });
  });

  // Inline Subtask Checkbox Handler
  list.querySelectorAll('.inline-subtask-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const taskId = cb.dataset.taskId;
      const subIdx = parseInt(cb.dataset.subIdx);
      const task = tasks.find(t => t.id === taskId);
      if (!task || !task.subtasks[subIdx]) return;
      task.subtasks[subIdx].done = cb.checked;
      saveData();
      renderTasks();
    });
  });

  attachSwipeGestures();
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

  const timeText = task.dueTime ? `<span class="due-time">⏰ ${task.dueTime}</span>` : '';

  let timerBadge = '';
  if (task.timerTargetTimestamp && !task.completed && !task.alarmRingTriggered) {
    const msLeft = task.timerTargetTimestamp - Date.now();
    timerBadge = `<span class="tag-badge alarm-active" id="countdown-${task.id}">⏱️ ${formatCountdownMs(msLeft)}</span>`;
  } else if (task.alarmRingTriggered && !task.completed) {
    timerBadge = `<span class="tag-badge alarm-active" style="background:var(--danger-light);color:var(--danger);border-color:var(--danger)">🔔 رنّ المنبه</span>`;
  }

  const subtasksBar = subtasksTotal > 0 ? `
    <div class="subtasks-bar-container">
      <div class="subtasks-bar-label">
        <button class="inline-subtasks-toggle" data-id="${task.id}">🔽 <span id="sub-count-${task.id}">${subtasksDone}/${subtasksTotal}</span> مهام فرعية</button>
      </div>
      <div class="subtasks-progress">
        <div class="subtasks-progress-fill" id="sub-fill-${task.id}" style="width:${subPct}%"></div>
      </div>
      <div class="inline-subtasks-container" id="subtasks-container-${task.id}">
        ${task.subtasks.map((s, i) => `
          <label class="inline-subtask-row ${s.done ? 'done' : ''}">
            <input type="checkbox" class="inline-subtask-check" data-task-id="${task.id}" data-sub-idx="${i}" ${s.done ? 'checked' : ''} />
            <span>${escapeHtml(s.text)}</span>
          </label>`).join('')}
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
            ${timeText}
            ${timerBadge}
          </div>
          ${subtasksBar}
        </div>
        <div class="task-actions">
          <button class="action-icon-btn task-timer-btn" data-id="${task.id}" title="ضبط منبه / مؤقت ⏰" aria-label="مؤقت">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
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

function formatDue(dateStr) {
  if (!dateStr) return '';
  // Compare dates only (no time component) to avoid false "late" on same day
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = d - today;
  if (diff < 0) return `⚠️ متأخرة`;
  if (diff === 0) return `📅 اليوم`;
  if (diff === 86400000) return `📅 غداً`;
  return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) {
    playCompleteSound();
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    showToast('✅ مهمة مكتملة! عمل رائع!', 'success');
    checkAllDone();
    checkBadges();
  }
  saveData();
  renderTasks();
  if (activeView === 'calendar') renderCalendar();
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

function addTask(data) {
  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title: data.title.trim(),
    description: (data.description || '').trim(),
    category: data.category || 'personal',
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    dueTime: data.dueTime || null,
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
  const oldSubtasks = tasks[idx].subtasks || [];
  const oldDueDate = tasks[idx].dueDate;
  const oldDueTime = tasks[idx].dueTime;
  const newDueDate = data.dueDate || null;
  const newDueTime = data.dueTime || null;
  // If due date/time changed, reset alarm trigger so it fires again
  const dueDateChanged = oldDueDate !== newDueDate || oldDueTime !== newDueTime;
  tasks[idx] = {
    ...tasks[idx],
    title: data.title.trim(),
    description: (data.description || '').trim(),
    category: data.category,
    priority: data.priority,
    dueDate: newDueDate,
    dueTime: newDueTime,
    // Preserve existing subtask completion state by matching on index
    subtasks: (data.subtasks || []).filter(s => s.text && s.text.trim()).map((s, i) => ({
      text: s.text.trim(),
      done: oldSubtasks[i] ? oldSubtasks[i].done : false,
    })),
    // Reset alarm if due date/time changed so it can fire again
    alarmRingTriggered: dueDateChanged ? false : tasks[idx].alarmRingTriggered,
  };
  saveData();
  renderTasks();
  showToast('✏️ تم تحديث المهمة!', 'info');
}

function deleteTask(id) {
  const target = tasks.find(t => t.id === id);
  if (!target) return;
  if (!confirm(`هل أنت متأكد من نقل المهمة "${target.title}" إلى سلة المهملات؟`)) return;

  createSnapshot('حذف مهمة');

  const trashItem = { ...target, deletedAt: Date.now() };
  const trash = getTrash();
  trash.unshift(trashItem);
  saveTrash(trash);

  tasks = tasks.filter(t => t.id !== id);
  saveData();
  renderTasks();
  showToast('🗑️ تم نقل المهمة إلى سلة المهملات', 'info');
}

function openAddModal() {
  editingTaskId = null;
  document.getElementById('modal-title').textContent = 'إضافة مهمة جديدة';
  document.getElementById('form-submit-btn').textContent = '✅ حفظ المهمة';
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  const timeInput = document.getElementById('task-time-input');
  if (timeInput) timeInput.value = '';
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
  const timeInput = document.getElementById('task-time-input');
  if (timeInput) timeInput.value = task.dueTime || '';
  document.getElementById('task-category-input').value = task.category;
  const prioInput = document.querySelector(`input[name="priority"][value="${task.priority}"]`);
  if (prioInput) prioInput.checked = true;

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
      ${task.dueDate ? `<p style="font-size:0.82rem;color:var(--text-muted)">📅 الموعد: ${formatDue(task.dueDate)} ${task.dueTime ? task.dueTime : ''}</p>` : ''}
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
//  Stats & Canvas Chart
// =============================================
function renderStats() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;
  const streak = getStreakData().days;

  const statsEl = document.getElementById('stats-grid');
  if (statsEl) {
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
  }

  drawWeeklyChart();

  const catBreakdown = document.getElementById('category-breakdown');
  if (catBreakdown) {
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
}

function drawWeeklyChart() {
  const canvas = document.getElementById('weekly-chart-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return; // Not yet visible
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const todayDayIdx = new Date().getDay();

  tasks.filter(t => t.completed).forEach(t => {
    const dayIdx = new Date(t.createdAt).getDay();
    counts[dayIdx]++;
  });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0d9488';
  const primaryColor2 = isDark ? '#2dd4bf' : '#0d9488';

  const maxVal = Math.max(...counts, 4);
  const width = rect.width;
  const height = rect.height;
  const padding = 28;
  const chartHeight = height - padding * 2;
  const barWidth = (width - padding * 2) / 7 - 10;

  ctx.clearRect(0, 0, width, height);

  days.forEach((day, i) => {
    const x = padding + i * ((width - padding * 2) / 7) + 5;
    const barH = (counts[i] / maxVal) * chartHeight;
    const y = height - padding - barH;
    const isToday = i === todayDayIdx;

    // Background track
    ctx.fillStyle = isToday ? 'rgba(45,212,191,0.12)' : 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, padding, barWidth, chartHeight, 6);
    else ctx.rect(x, padding, barWidth, chartHeight);
    ctx.fill();

    // Bar gradient – today is brighter
    const grad = ctx.createLinearGradient(0, y, 0, height - padding);
    if (isToday) {
      grad.addColorStop(0, '#2dd4bf');
      grad.addColorStop(1, '#0d9488');
    } else {
      grad.addColorStop(0, primaryColor);
      grad.addColorStop(1, primaryColor2);
    }
    ctx.fillStyle = grad;
    ctx.globalAlpha = isToday ? 1 : 0.75;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barWidth, Math.max(barH, 4), 6);
    else ctx.rect(x, y, barWidth, Math.max(barH, 4));
    ctx.fill();
    ctx.globalAlpha = 1;

    // Day label
    ctx.fillStyle = isToday ? (isDark ? '#2dd4bf' : '#0d9488') : '#94a3b8';
    ctx.font = `${isToday ? '700' : '500'} 10px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(day, x + barWidth / 2, height - 6);

    // Count label
    if (counts[i] > 0) {
      ctx.fillStyle = isToday ? '#fff' : '#94a3b8';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText(counts[i], x + barWidth / 2, y - 4);
    }
  });
}

function showView(view) {
  activeView = view;
  const mainContent = document.querySelector('.app-content');
  const calendarView = document.getElementById('calendar-view');
  const statsView = document.getElementById('stats-view');
  const settingsView = document.getElementById('settings-view');
  const fab = document.getElementById('fab-btn');

  mainContent.style.display = 'none';
  if (calendarView) calendarView.style.display = 'none';
  statsView.style.display = 'none';
  settingsView.style.display = 'none';

  if (view === 'calendar') {
    if (calendarView) calendarView.style.display = 'block';
    fab.style.display = 'flex';
    renderCalendar();
  } else if (view === 'stats') {
    statsView.style.display = 'block';
    fab.style.display = 'none';
    renderStats();
    renderBadges();
  } else if (view === 'settings') {
    settingsView.style.display = 'block';
    fab.style.display = 'none';
    updateDatabaseInfoUI();
    updateAlarmBtnUI();
  } else {
    mainContent.style.display = 'block';
    fab.style.display = 'flex';
    renderTasks();
  }
}

function playCompleteSound() {
  if (!soundEnabled) return;
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
  } catch (e) { }
}

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
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
    if (elapsed < 150) requestAnimationFrame(draw);
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  draw();
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const colors = { success: '#10b981', info: '#0d9488', error: '#ef4444' };
  toast.style.borderLeftColor = colors[type] || colors.info;
  toast.style.borderLeftWidth = '4px';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    if (theme === 'dark') {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
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
    emerald: '#059669',
    rose: '#f43f5e',
    amber: '#d97706',
    indigo: '#4f46e5'
  };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && themeColors[colorTheme]) {
    themeMeta.setAttribute('content', themeColors[colorTheme]);
  }
}

function updateSoundUI() {
  const btn = document.getElementById('toggle-sound-btn');
  const desc = document.getElementById('sound-status-desc');
  if (btn) {
    if (soundEnabled) {
      btn.textContent = 'مفعّل 🔊';
      btn.style.background = 'var(--primary)';
      btn.style.color = '#ffffff';
      if (desc) desc.textContent = 'المؤثرات الصوتية مفعّلة عند إنجاز المهام والمنبه 🔊';
    } else {
      btn.textContent = 'مكتوم 🔇';
      btn.style.background = 'var(--surface-solid)';
      btn.style.color = 'var(--text-muted)';
      if (desc) desc.textContent = 'تم كتم جميع الأصوات والمؤثرات التفاعلية 🔇';
    }
  }
}

function updateAutoThemeUI() {
  const btn = document.getElementById('auto-theme-btn');
  const desc = document.getElementById('theme-mode-desc');
  if (btn) {
    if (isAutoTheme) {
      btn.style.background = 'var(--primary)';
      btn.style.color = '#ffffff';
      if (desc) desc.textContent = 'تلقائي: يتكيف تلقائياً مع نظام التشغيل 💻';
    } else {
      btn.style.background = 'var(--surface-solid)';
      btn.style.color = 'var(--text-muted)';
      if (desc) desc.textContent = 'مُخصص: تبديل يدوي بين الوضع الفاتح والداكن';
    }
  }
}

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

// =============================================
//  Trash, Snapshots, Smart Merge & PIN Security
// =============================================

function getTrash() {
  try { return JSON.parse(localStorage.getItem(TRASH_KEY)) || []; }
  catch { return []; }
}

function saveTrash(trashList) {
  localStorage.setItem(TRASH_KEY, JSON.stringify(trashList));
  if (dbInstance) {
    try {
      const tx = dbInstance.transaction('trash', 'readwrite');
      const store = tx.objectStore('trash');
      store.clear();
      trashList.forEach(t => store.put(t));
    } catch (e) {
      console.warn('Trash DB sync error:', e);
    }
  }
}

function purgeOldTrash() {
  const trash = getTrash();
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const filtered = trash.filter(item => (item.deletedAt || 0) > thirtyDaysAgo);
  if (filtered.length !== trash.length) {
    saveTrash(filtered);
  }
}

function restoreTaskFromTrash(id) {
  let trash = getTrash();
  const targetIndex = trash.findIndex(t => t.id === id);
  if (targetIndex === -1) return;

  const restored = trash.splice(targetIndex, 1)[0];
  delete restored.deletedAt;
  tasks.unshift(restored);

  saveTrash(trash);
  saveData();
  renderTasks();
  renderTrashUI();
  showToast('↩️ تم استعادة المهمة بنجاح!', 'success');
}

function permanentlyDeleteTrashTask(id) {
  if (!confirm('حذف هذه المهمة نهائياً من السلة؟')) return;
  let trash = getTrash();
  trash = trash.filter(t => t.id !== id);
  saveTrash(trash);
  renderTrashUI();
  showToast('❌ تم الحذف النهائي', 'info');
}

function emptyTrash() {
  const trash = getTrash();
  if (trash.length === 0) {
    showToast('سلة المهملات فارغة بالفعل', 'info');
    return;
  }
  if (!confirm('هل أنت متأكد من تفريغ سلة المهملات تماماً؟')) return;
  saveTrash([]);
  renderTrashUI();
  showToast('🧹 تم تفريغ سلة المهملات بالكامل', 'info');
}

function renderTrashUI() {
  const container = document.getElementById('trash-items-list');
  if (!container) return;
  const trash = getTrash();

  if (trash.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:20px;"><p>سلة المهملات فارغة 🗑️</p></div>`;
    return;
  }

  container.innerHTML = trash.map(t => {
    const deletedDate = new Date(t.deletedAt || Date.now()).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    return `
      <div style="background:var(--surface-hover);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:0.88rem;color:var(--text-main);display:block;">${t.title}</strong>
          <span style="font-size:0.72rem;color:var(--text-muted);">حُذفت: ${deletedDate}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="chip-btn" onclick="restoreTaskFromTrash('${t.id}')" style="margin:0;padding:5px 10px;font-size:0.75rem;background:var(--primary);color:#fff;border:none;">استعادة ↩️</button>
          <button class="chip-btn" onclick="permanentlyDeleteTrashTask('${t.id}')" style="margin:0;padding:5px 8px;font-size:0.75rem;color:var(--danger);border-color:var(--danger-light);">حذف ❌</button>
        </div>
      </div>
    `;
  }).join('');
}

// Snapshots System
function getSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY)) || []; }
  catch { return []; }
}

function createSnapshot(reason = 'تحديث عادي') {
  const snapshots = getSnapshots();
  const newSnapshot = {
    id: 'snap_' + Date.now(),
    timestamp: Date.now(),
    reason,
    count: tasks.length,
    tasksData: JSON.parse(JSON.stringify(tasks))
  };
  snapshots.unshift(newSnapshot);
  if (snapshots.length > 5) snapshots.pop();
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
}

function restoreSnapshot(snapId) {
  const snapshots = getSnapshots();
  const snap = snapshots.find(s => s.id === snapId);
  if (!snap) return;

  if (!confirm(`استعادة اللقطة (${snap.reason}) التي تحتوي على ${snap.count} مهمة؟`)) return;

  createSnapshot('قبل استعادة اللقطة');
  tasks = JSON.parse(JSON.stringify(snap.tasksData));
  saveData();
  renderTasks();
  document.getElementById('snapshots-modal')?.classList.remove('open');
  showToast('⏪ تم استعادة اللقطة بنجاح!', 'success');
}

function renderSnapshotsUI() {
  const container = document.getElementById('snapshots-items-list');
  if (!container) return;
  const snapshots = getSnapshots();

  if (snapshots.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:20px;"><p>لا توجد لقطات تاريخية محفوطة ⏪</p></div>`;
    return;
  }

  container.innerHTML = snapshots.map(s => {
    const timeStr = new Date(s.timestamp).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    return `
      <div style="background:var(--surface-hover);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:0.88rem;color:var(--text-main);display:block;">${s.reason}</strong>
          <span style="font-size:0.72rem;color:var(--text-muted);">${timeStr} • ${s.count} مهمة</span>
        </div>
        <button class="chip-btn" onclick="restoreSnapshot('${s.id}')" style="margin:0;padding:6px 12px;font-size:0.78rem;background:var(--primary);color:#fff;border:none;">استعادة ⏪</button>
      </div>
    `;
  }).join('');
}

// Smart Merge Import
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedTasks = JSON.parse(e.target.result);
      if (Array.isArray(importedTasks)) {
        createSnapshot('قبل الاستيراد والدمج');
        let mergedCount = 0;
        const existingIds = new Set(tasks.map(t => t.id));

        importedTasks.forEach(imp => {
          if (imp && imp.id && !existingIds.has(imp.id)) {
            tasks.push(imp);
            mergedCount++;
          }
        });

        saveData();
        renderTasks();
        showToast(`📤 تم دمج ${mergedCount} مهمة جديدة بنجاح!`, 'success');
      } else {
        showToast('⚠️ ملف النسخة الاحتياطية غير صالح', 'error');
      }
    } catch (err) {
      showToast('⚠️ خطأ في قراءة ملف التنسيق', 'error');
    }
  };
  reader.readAsText(file);
}

function clearCompletedTasks() {
  const completedTasks = tasks.filter(t => t.completed);
  if (completedTasks.length === 0) {
    showToast('لا توجد مهام مكتملة لمسحها', 'info');
    return;
  }
  if (!confirm(`هل أنت متأكد من نقل ${completedTasks.length} مهمة مكتملة إلى السلة؟`)) return;

  createSnapshot('مسح المكتملة');
  const trash = getTrash();
  completedTasks.forEach(t => {
    trash.unshift({ ...t, deletedAt: Date.now() });
  });
  saveTrash(trash);

  tasks = tasks.filter(t => !t.completed);
  saveData();
  renderTasks();
  showToast('🧹 تم نقل المهام المكتملة إلى سلة المهملات', 'info');
}

// PIN Protection Security
function checkPINProtection() {
  const pin = localStorage.getItem(PIN_KEY);
  const btn = document.getElementById('toggle-pin-btn');
  const desc = document.getElementById('pin-status-desc');

  if (pin) {
    if (btn) btn.textContent = 'إلغاء القفل 🔓';
    if (desc) desc.textContent = '🔒 التطبيق محمى برمز PIN';
    if (!sessionStorage.getItem('pin_unlocked')) {
      document.getElementById('pin-entry-modal')?.classList.add('open');
    }
  } else {
    if (btn) btn.textContent = 'تفعيل 🔒';
    if (desc) desc.textContent = 'تشفير وحماية التطبيق برمز سرى';
  }
}

function togglePINSetting() {
  const currentPin = localStorage.getItem(PIN_KEY);
  if (currentPin) {
    const input = prompt('أدخل رمز PIN الحالي لإلغاء القفل:');
    if (input === currentPin) {
      localStorage.removeItem(PIN_KEY);
      sessionStorage.removeItem('pin_unlocked');
      checkPINProtection();
      showToast('🔓 تم إلغاء قفل البيانات برمز PIN', 'info');
    } else if (input !== null) {
      showToast('⚠️ رمز PIN غير صحيح', 'error');
    }
  } else {
    const newPin = prompt('أنشئ رمز PIN سري مكون من 4 أرقام:');
    if (newPin && /^\d{4}$/.test(newPin.trim())) {
      localStorage.setItem(PIN_KEY, newPin.trim());
      sessionStorage.setItem('pin_unlocked', 'true');
      checkPINProtection();
      showToast('🔒 تم تفعيل قفل PIN بنجاح!', 'success');
    } else if (newPin !== null) {
      showToast('⚠️ ينبغي كتابة 4 أرقام فقط', 'error');
    }
  }
}

function verifyPINInput() {
  const input = document.getElementById('pin-digit-input');
  if (!input) return;
  const val = input.value.trim();
  const currentPin = localStorage.getItem(PIN_KEY);

  if (val === currentPin) {
    sessionStorage.setItem('pin_unlocked', 'true');
    document.getElementById('pin-entry-modal')?.classList.remove('open');
    showToast('🔓 مرحباً بك! تم الفتح بنجاح', 'success');
  } else {
    showToast('⚠️ رمز PIN خطأ! حاول مجدداً', 'error');
    input.value = '';
    input.focus();
  }
}

window.restoreTaskFromTrash = restoreTaskFromTrash;
window.permanentlyDeleteTrashTask = permanentlyDeleteTrashTask;
window.restoreSnapshot = restoreSnapshot;

// =============================================
//  Swipe Gestures & Voice Memos
// =============================================
function attachSwipeGestures() {
  document.querySelectorAll('.task-card').forEach(card => {
    let startX = 0;
    let diffX = 0;
    let isSwiping = false;
    const taskId = card.id.replace('task-', '');

    const onStart = (e) => {
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      isSwiping = true;
    };

    const onMove = (e) => {
      if (!isSwiping) return;
      const currentX = e.touches ? e.touches[0].clientX : e.clientX;
      diffX = currentX - startX;

      if (Math.abs(diffX) > 25) {
        card.style.transform = `translateX(${diffX * 0.4}px)`;
        card.classList.toggle('swiping-right', diffX > 40);
        card.classList.toggle('swiping-left', diffX < -40);
      }
    };

    const onEnd = () => {
      if (!isSwiping) return;
      isSwiping = false;
      card.style.transform = '';
      card.classList.remove('swiping-right', 'swiping-left');

      if (diffX > 90) {
        toggleTask(taskId);
      } else if (diffX < -90) {
        openTimerModal(taskId);
      }
      diffX = 0;
    };

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onEnd);
  });
}

function getMemos() {
  try { return JSON.parse(localStorage.getItem(MEMOS_KEY)) || []; }
  catch { return []; }
}

function saveMemos(memos) {
  localStorage.setItem(MEMOS_KEY, JSON.stringify(memos));
}

function renderMemos() {
  const container = document.getElementById('memos-list');
  if (!container) return;
  const memos = getMemos();

  if (memos.length === 0) {
    container.innerHTML = `<p class="memo-empty-txt">لا توجد مذكرات مثبتة. اضغط تسجيل لإضافة فكرة سريعة!</p>`;
    return;
  }

  container.innerHTML = memos.map((memo, idx) => `
    <div class="memo-item">
      <span class="memo-item-text">💡 ${escapeHtml(memo.text)}</span>
      <div class="memo-actions">
        <button class="chip-btn" onclick="convertMemoToTask(${idx})" style="padding:4px 8px;font-size:0.72rem;background:var(--primary-light);color:var(--primary);border-color:var(--primary)">➕ مهمة</button>
        <button class="action-icon-btn delete" onclick="deleteMemo(${idx})" title="حذف" style="padding:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>`).join('');
}

function recordQuickVoiceMemo() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const text = prompt('اكتب فكرة سريعة لتثبيتها:');
    if (text && text.trim()) addMemoText(text.trim());
    return;
  }

  const recognition = new SpeechRec();
  recognition.lang = 'ar-EG';
  showToast('🎙️ تحدث الآن بكتابة الفكرة السريعة...', 'info');

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if (text && text.trim()) {
      addMemoText(text.trim());
      showToast(`📌 تم تثبيت المذكرة: "${text}"`, 'success');
    }
  };

  recognition.onerror = () => {
    const fallback = prompt('لم يتم التقاط الصوت. اكتب الفكرة يدويًا:');
    if (fallback && fallback.trim()) addMemoText(fallback.trim());
  };

  recognition.start();
}

function addMemoText(text) {
  const memos = getMemos();
  memos.unshift({ text, createdAt: new Date().toISOString() });
  saveMemos(memos);
  renderMemos();
}

function convertMemoToTask(idx) {
  const memos = getMemos();
  if (!memos[idx]) return;
  const text = memos[idx].text;

  addTask({ title: text, category: 'personal', priority: 'medium' });
  memos.splice(idx, 1);
  saveMemos(memos);
  renderMemos();
  showToast('✅ تم تحويل المذكرة إلى مهمة بنجاح!', 'success');
}

function deleteMemo(idx) {
  const memos = getMemos();
  memos.splice(idx, 1);
  saveMemos(memos);
  renderMemos();
}

// Bind global functions to window explicitly for inline onclick handlers
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.openEditModal = openEditModal;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.convertMemoToTask = convertMemoToTask;
window.deleteMemo = deleteMemo;


// =============================================
//  DOMContentLoaded Initialization
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initAlarmSystem();
  // initStickyNotification: update sticky if already enabled
  if (stickyEnabled) updateStickyNotification();

  soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
  isAutoTheme = localStorage.getItem(AUTO_THEME_KEY) === 'true';
  updateSoundUI();
  updateAutoThemeUI();

  if (isAutoTheme) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  } else {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);
  }

  // Listen for system theme changes if auto theme is active
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (isAutoTheme) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  const savedColorTheme = localStorage.getItem(COLOR_THEME_KEY) || 'teal';
  applyColorTheme(savedColorTheme);

  isGridMode = localStorage.getItem(LAYOUT_MODE_KEY) === 'true';

  updateGreeting();
  updatePomoUI();
  renderTasks();
  updateProgressUI();

  // Pomodoro Controls
  document.getElementById('pomo-start-btn')?.addEventListener('click', togglePomoTimer);
  document.getElementById('pomo-reset-btn')?.addEventListener('click', resetPomoTimer);

  // Voice Input Buttons
  // Header mic btn → opens add modal, then captures voice into title field
  document.getElementById('voice-input-btn')?.addEventListener('click', () => {
    if (document.getElementById('task-modal')?.classList.contains('open')) {
      startVoiceRecognition('task-title-input');
    } else {
      openAddModal();
      setTimeout(() => startVoiceRecognition('task-title-input'), 450);
    }
  });
  document.getElementById('modal-mic-btn')?.addEventListener('click', () => startVoiceRecognition('task-title-input'));

  // Alarm Permission Button
  document.getElementById('alarm-permission-btn')?.addEventListener('click', toggleAlarmPermission);

  // Sticky Notification Button
  document.getElementById('sticky-permission-btn')?.addEventListener('click', toggleStickyPermission);

  // Refresh sticky notification on app focus (updates pending count)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateStickyNotification();
  });

  // Template Quick Chips
  document.querySelectorAll('.template-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.template;
      const category = btn.dataset.category || 'personal';
      addTask({ title, category, priority: 'medium', description: '', subtasks: [] });
    });
  });

  // Layout Toggle
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

  // FAB
  document.getElementById('fab-btn')?.addEventListener('click', openAddModal);

  // Theme Toggle
  const toggleThemeHandler = () => {
    isAutoTheme = false;
    localStorage.setItem(AUTO_THEME_KEY, 'false');
    updateAutoThemeUI();
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleThemeHandler);
  document.getElementById('settings-theme-btn')?.addEventListener('click', toggleThemeHandler);

  // Auto Theme Toggle
  document.getElementById('auto-theme-btn')?.addEventListener('click', () => {
    isAutoTheme = !isAutoTheme;
    localStorage.setItem(AUTO_THEME_KEY, isAutoTheme);
    updateAutoThemeUI();
    if (isAutoTheme) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
      showToast('💻 تم تفعيل المزامنة التلقائية مع النظام!', 'success');
    } else {
      showToast('🌙 تم تعطيل المزامنة التلقائية', 'info');
    }
  });

  // Sound Toggle
  document.getElementById('toggle-sound-btn')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem(SOUND_KEY, soundEnabled);
    updateSoundUI();
    if (soundEnabled) {
      playCompleteSound();
      showToast('🔊 تم تفعيل الأصوات والمؤثرات!', 'success');
    } else {
      showToast('🔇 تم كتم الأصوات والمؤثرات', 'info');
    }
  });

  // Swatches
  document.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      applyColorTheme(swatch.dataset.color);
      showToast('🎨 تم تغيير ثيم الألوان!', 'info');
    });
  });

  // Backup
  document.getElementById('export-data-btn')?.addEventListener('click', exportData);
  const importBtn = document.getElementById('import-trigger-btn');
  const importInput = document.getElementById('import-file-input');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importData(e.target.files[0]);
      }
    });
  }

  document.getElementById('clear-completed-btn')?.addEventListener('click', clearCompletedTasks);

  // Search Toggle
  const searchBox = document.getElementById('search-box');
  document.getElementById('search-toggle-btn')?.addEventListener('click', () => {
    const isHidden = searchBox.style.display === 'none';
    searchBox.style.display = isHidden ? 'block' : 'none';
    if (isHidden) document.getElementById('search-input')?.focus();
  });

  document.getElementById('search-input')?.addEventListener('input', (e) => {
    currentFilter.search = e.target.value;
    renderTasks();
  });

  // Category Filter – scoped to #categories-filter only (not template chips)
  document.getElementById('categories-filter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('#categories-filter [data-category]');
    if (!btn) return;
    document.querySelectorAll('#categories-filter [data-category]').forEach(b => b.classList.remove('active'));
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

  // Modals Close
  document.getElementById('modal-close-btn')?.addEventListener('click', closeTaskModal);
  document.getElementById('task-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('task-modal')) closeTaskModal();
  });

  document.getElementById('detail-close-btn')?.addEventListener('click', closeDetailModal);
  document.getElementById('detail-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('detail-modal')) closeDetailModal();
  });

  // Subtask Add Button
  document.getElementById('add-subtask-btn')?.addEventListener('click', () => {
    const count = document.querySelectorAll('.subtask-input').length + 1;
    document.getElementById('subtasks-input-list')?.insertAdjacentHTML('beforeend', `
      <div class="subtask-input-item">
        <input type="text" class="form-control subtask-input" placeholder="مهمة فرعية ${count}..." />
        <button type="button" class="action-icon-btn delete" onclick="this.parentElement.remove()" aria-label="حذف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`);
    document.querySelector('.subtask-input:last-of-type')?.focus();
  });

  // Form Submit
  document.getElementById('task-form')?.addEventListener('submit', (e) => {
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
      priority: document.querySelector('input[name="priority"]:checked')?.value || 'medium',
      dueDate: document.getElementById('task-date-input').value,
      dueTime: document.getElementById('task-time-input')?.value || null,
      subtasks: Array.from(document.querySelectorAll('.subtask-input')).map(i => ({ text: i.value })),
    };

    if (editingTaskId) {
      updateTask(editingTaskId, data);
    } else {
      addTask(data);
    }
    closeTaskModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Only dismiss alarm popup if it is actually open (prevent accidental stop)
      const alarmModal = document.getElementById('alarm-alert-modal');
      if (alarmModal?.classList.contains('open')) {
        dismissAlarmPopup('only');
        return;
      }
      closeTaskModal();
      closeDetailModal();
      closeTimerModal();
    }
  });

  // Timer Modal Controls
  document.querySelectorAll('.quick-timer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTaskTimer(parseInt(btn.dataset.mins));
    });
  });

  document.getElementById('custom-timer-start-btn')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('custom-timer-input').value);
    if (!val || val <= 0) {
      showToast('⚠️ يرجى كتابة عدد الدقائق بصورة صحيحة', 'error');
      return;
    }
    setTaskTimer(val);
  });

  document.getElementById('cancel-timer-btn')?.addEventListener('click', cancelActiveTaskTimer);
  document.getElementById('timer-close-btn')?.addEventListener('click', closeTimerModal);
  document.getElementById('timer-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('timer-modal')) closeTimerModal();
  });

  // Alarm Popup Dismiss Buttons
  document.getElementById('alarm-dismiss-done-btn')?.addEventListener('click', () => dismissAlarmPopup('done'));
  document.getElementById('alarm-dismiss-only-btn')?.addEventListener('click', () => dismissAlarmPopup('only'));

  // Record Voice Memo Button
  document.getElementById('record-memo-btn')?.addEventListener('click', recordQuickVoiceMemo);
  renderMemos();

  // Background Particles Canvas
  initParticleCanvas();

  // Button Ripple Effect
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn, .btn-primary');
    if (!btn) return;
    const circle = document.createElement('span');
    circle.classList.add('ripple');
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    circle.style.width = circle.style.height = `${size}px`;
    circle.style.left = `${e.clientX - rect.left - size / 2}px`;
    circle.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });
});

// Ambient Background Particle Canvas System
// Disabled on mobile to prevent lag — runs throttled at ~20fps on desktop
function initParticleCanvas() {
  // Skip entirely on mobile / small screens — biggest source of lag
  if (window.innerWidth <= 768) {
    const canvas = document.getElementById('particle-canvas');
    if (canvas) canvas.style.display = 'none';
    return;
  }

  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    // If user resizes to mobile width, stop the canvas
    if (window.innerWidth <= 768) {
      canvas.style.display = 'none';
      return;
    }
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  // Fewer particles, slower movement
  const particles = Array.from({ length: 20 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.random() * 2 + 0.8,
    vx: (Math.random() - 0.5) * 0.25,
    vy: (Math.random() - 0.5) * 0.25,
    alpha: Math.random() * 0.4 + 0.15,
  }));

  // Throttle to ~20fps instead of 60fps
  let lastTime = 0;
  const FPS_INTERVAL = 1000 / 20;

  function animate(timestamp) {
    if (window.innerWidth <= 768) return; // stop if resized to mobile
    requestAnimationFrame(animate);
    const elapsed = timestamp - lastTime;
    if (elapsed < FPS_INTERVAL) return;
    lastTime = timestamp - (elapsed % FPS_INTERVAL);

    ctx.clearRect(0, 0, width, height);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(13,148,136,0.30)';

    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;
    });
  }
  requestAnimationFrame(animate);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('TaskFlow SW registered'))
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// =============================================
//  Calendar View System — Enhanced v2
// =============================================
let currentCalDate = new Date();
let selectedCalDateStr = new Date().toISOString().slice(0, 10);
let calendarFilter = 'all'; // 'all' | 'pending' | 'done'

/* Priority colour mapping for heatmap dots */
const PRIORITY_DOT_COLOR = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#22c55e'
};

function getMonthTasks(year, month) {
  const pad = n => String(n).padStart(2, '0');
  const prefix = `${year}-${pad(month + 1)}`;
  return tasks.filter(t => t.dueDate && t.dueDate.startsWith(prefix));
}

function updateCalMonthlyOverview() {
  const year  = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const monthTasks = getMonthTasks(year, month);
  const total  = monthTasks.length;
  const done   = monthTasks.filter(t => t.completed).length;
  const remain = total - done;
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;

  const toArabicNumerals = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

  const elTotal  = document.getElementById('cal-stat-total');
  const elDone   = document.getElementById('cal-stat-done');
  const elRemain = document.getElementById('cal-stat-remain');
  const elFill   = document.getElementById('cal-month-progress-fill');

  if (elTotal)  elTotal.textContent  = `📋 ${toArabicNumerals(total)} مهمة`;
  if (elDone)   elDone.textContent   = `✅ ${toArabicNumerals(done)} مكتملة`;
  if (elRemain) elRemain.textContent = `⏳ ${toArabicNumerals(remain)} متبقية`;
  if (elFill)   elFill.style.width   = `${pct}%`;
}

function renderCalendar() {
  const grid    = document.getElementById('calendar-days-grid');
  const titleEl = document.getElementById('cal-month-year-title');
  if (!grid || !titleEl) return;

  const year  = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();

  const monthNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  titleEl.textContent = `${monthNames[month]} ${year}`;

  // Sunday-first week. getDay() is 0-6 where 0=Sunday (already correct for Arabic-RTL display)
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays     = new Date(year, month + 1, 0).getDate();
  const todayStr      = new Date().toISOString().slice(0, 10);

  let html = '';

  // Empty leading cells
  for (let i = 0; i < firstDayIndex; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const pad = n => String(n).padStart(2, '0');
    const dayDateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
    const dayTasks   = tasks.filter(t => t.dueDate === dayDateStr);
    const hasTasks   = dayTasks.length > 0;
    const isSelected = dayDateStr === selectedCalDateStr;
    const isToday    = dayDateStr === todayStr;

    // Build up to 3 priority dots, sorted: high → medium → low
    let dotsHtml = '';
    if (hasTasks) {
      const priorities = dayTasks.map(t => t.priority || 'low');
      const order = ['high', 'medium', 'low'];
      const sorted = priorities.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const displayed = [...new Set(sorted)].slice(0, 3);
      dotsHtml = `<div class="cal-day-dots">${displayed.map(p =>
        `<span class="cal-dot" style="background:${isSelected ? '#fff' : PRIORITY_DOT_COLOR[p] || 'var(--primary)'}"></span>`
      ).join('')}</div>`;
    }

    const classes = [
      'cal-day',
      isToday    ? 'today'    : '',
      isSelected ? 'selected' : '',
      hasTasks   ? 'has-tasks': ''
    ].filter(Boolean).join(' ');

    html += `<div class="${classes}" onclick="selectCalendarDate('${dayDateStr}')" role="button" tabindex="0" aria-label="${d}">
      <span class="cal-day-num">${d}</span>
      ${dotsHtml}
    </div>`;
  }

  grid.innerHTML = html;

  updateCalMonthlyOverview();
  renderSelectedCalDateTasks();
}

function isTodayMatch(dateStr, targetDateStr) {
  if (!dateStr) return false;
  return new Date(dateStr).toISOString().slice(0, 10) === targetDateStr;
}

function selectCalendarDate(dateStr) {
  selectedCalDateStr = dateStr;
  renderCalendar();
}

function renderSelectedCalDateTasks() {
  const container = document.getElementById('calendar-selected-tasks-list');
  const title     = document.getElementById('selected-date-title');
  if (!container) return;

  const d             = new Date(selectedCalDateStr + 'T00:00:00');
  const dateFormatted = d.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (title) title.textContent = `📅 مهام يوم: ${dateFormatted}`;

  let dayTasks = tasks.filter(t => t.dueDate === selectedCalDateStr);

  // Apply filter
  if (calendarFilter === 'pending') dayTasks = dayTasks.filter(t => !t.completed);
  if (calendarFilter === 'done')    dayTasks = dayTasks.filter(t =>  t.completed);

  if (dayTasks.length === 0) {
    const emptyMsg = calendarFilter === 'all'
      ? `<div class="empty-state" style="padding:24px;"><p>لا توجد مهام لهذا اليوم ☕</p></div>`
      : `<div class="empty-state" style="padding:24px;"><p>لا توجد مهام مطابقة للفلتر 🔍</p></div>`;
    container.innerHTML = emptyMsg;
    return;
  }

  container.innerHTML = dayTasks.map(t => createTaskCard(t)).join('');
}

// =============================================
//  Gamification & Badges System
// =============================================
const BADGES_KEY = 'taskflow_badges';

const BADGES = [
  { id: 'first_step', title: 'البداية القوية 🚀', desc: 'أكملت أول مهمة بنجاح', icon: '🌟' },
  { id: 'streak_3', title: 'شعلة الإنجاز 🔥', desc: 'سلسلة إنجاز 3 أيام متتالية', icon: '🔥' },
  { id: 'speed_demon', title: 'بطل السرعة ⚡', desc: 'أنجزت 5 مهام مكتملة', icon: '⚡' },
  { id: 'planner', title: 'مخطط محترف 🎓', desc: 'أنجزت مهمة ذات مهام فرعية', icon: '🎓' },
  { id: 'master_10', title: 'أسطورة الإنتاجية 🏆', desc: 'أنجزت 10 مهام بالكامل', icon: '🏆' },
  { id: 'pomo_king', title: 'ملك التركيز 🧘', desc: 'أنهيت جلسة مؤقت التركيز', icon: '🧘' }
];

function getUnlockedBadges() {
  try { return JSON.parse(localStorage.getItem(BADGES_KEY)) || []; }
  catch { return []; }
}

function checkBadges() {
  const unlocked = getUnlockedBadges();
  const completedCount = tasks.filter(t => t.completed).length;
  const streakDays = getStreakData().days;
  const hasSubtaskCompleted = tasks.some(t => t.completed && t.subtasks && t.subtasks.length > 0);

  const newUnlocks = [];

  if (completedCount >= 1 && !unlocked.includes('first_step')) newUnlocks.push('first_step');
  if (streakDays >= 3 && !unlocked.includes('streak_3')) newUnlocks.push('streak_3');
  if (completedCount >= 5 && !unlocked.includes('speed_demon')) newUnlocks.push('speed_demon');
  if (hasSubtaskCompleted && !unlocked.includes('planner')) newUnlocks.push('planner');
  if (completedCount >= 10 && !unlocked.includes('master_10')) newUnlocks.push('master_10');

  if (newUnlocks.length > 0) {
    const updated = [...unlocked, ...newUnlocks];
    localStorage.setItem(BADGES_KEY, JSON.stringify(updated));
    const firstNew = BADGES.find(b => b.id === newUnlocks[0]);
    if (firstNew) {
      launchConfetti();
      showToast(`🏆 وسام جديد: "${firstNew.title}"!`, 'success');
    }
  }
}

function renderBadges() {
  const container = document.getElementById('badges-container');
  if (!container) return;
  const unlocked = getUnlockedBadges();

  container.innerHTML = BADGES.map(b => {
    const isUnlocked = unlocked.includes(b.id);
    return `
      <div style="background:${isUnlocked ? 'var(--primary-light)' : 'var(--surface-hover)'};border:1px solid ${isUnlocked ? 'var(--primary)' : 'var(--border)'};border-radius:var(--radius-md);padding:12px;text-align:center;opacity:${isUnlocked ? '1' : '0.45'};transition:var(--spring);">
        <div style="font-size:2rem;margin-bottom:4px;">${b.icon}</div>
        <div style="font-size:0.82rem;font-weight:800;color:var(--text-main);">${b.title}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${b.desc}</div>
        <span style="font-size:0.65rem;font-weight:700;color:${isUnlocked ? 'var(--primary)' : 'var(--text-muted)'};margin-top:4px;display:block;">${isUnlocked ? '✅ مُكتسب' : '🔒 قيد الفتح'}</span>
      </div>`;
  }).join('');
}

// =============================================
//  AI Task Assistant Subtask Generator
// =============================================
function generateAISubtasks() {
  const titleInput = document.getElementById('task-title-input');
  if (!titleInput || !titleInput.value.trim()) {
    showToast('⚠️ اكتب عنوان المهمة أولاً لتوليد التقسيم الذكي', 'error');
    titleInput?.focus();
    return;
  }

  const title = titleInput.value.trim().toLowerCase();
  let suggestions = [];

  if (title.includes('دراسة') || title.includes('مذاكرة') || title.includes('قراءة') || title.includes('كتاب')) {
    suggestions = ['تحديد الفصول المطلوبة', 'قراءة ملخص الدرس', 'حل التمارين والأسئلة', 'مراجعة النقاط الصعبة'];
  } else if (title.includes('تمرين') || title.includes('رياضة') || title.includes('نادي') || title.includes('جيم')) {
    suggestions = ['الإحماء لـ 5 دقائق', 'تمارين الإطالة والصدر', 'تمارين الكارديو', 'شرب الماء والراحة'];
  } else if (title.includes('مشروع') || title.includes('برمجة') || title.includes('عمل') || title.includes('تقرير')) {
    suggestions = ['تحديد المتطلبات والأهداف', 'إعداد المسودة الأولى', 'مراجعة وتعديل الأخطاء', 'تسليم النسخة النهائية'];
  } else if (title.includes('تسوق') || title.includes('شراء') || title.includes('سوبر')) {
    suggestions = ['كتابة قائمة الاحتياجات', 'مقارنة الأسعار', 'شراء الأغراض الأساسية'];
  } else {
    suggestions = [`التحضير لـ ${title}`, `تنفيذ الخطوة الأولى`, `المراجعة النهائية والتأكد`];
  }

  const list = document.getElementById('subtasks-input-list');
  if (list) {
    list.innerHTML = suggestions.map(text => `
      <div class="subtask-input-item">
        <input type="text" class="form-control subtask-input" value="${escapeHtml(text)}" placeholder="مهمة فرعية..." />
        <button type="button" class="action-icon-btn delete" onclick="this.parentElement.remove()" aria-label="حذف">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
    showToast('🤖 تم توليد التقسيم الذكي للمهمة!', 'success');
  }
}

// =============================================
//  Synthesized Ambient Audio Generator
// =============================================
let activeAudioCtx = null;
let ambientSourceNode = null;
let currentAmbientType = 'none';

function startAmbientSound(type) {
  stopAmbientSound();
  currentAmbientType = type;
  if (type === 'none') return;

  try {
    activeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const bufferSize = activeAudioCtx.sampleRate * 2;
    const noiseBuffer = activeAudioCtx.createBuffer(1, bufferSize, activeAudioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = activeAudioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = activeAudioCtx.createBiquadFilter();
    const gainNode = activeAudioCtx.createGain();

    if (type === 'rain') {
      filter.type = 'lowpass';
      filter.frequency.value = 1000;
      gainNode.gain.value = 0.15;
    } else if (type === 'forest') {
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      gainNode.gain.value = 0.1;
    } else if (type === 'ocean') {
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      gainNode.gain.value = 0.2;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      gainNode.gain.value = 0.12;
    }

    whiteNoise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(activeAudioCtx.destination);
    whiteNoise.start();
    ambientSourceNode = whiteNoise;
  } catch (e) { console.warn('Ambient sound synthesis error:', e); }
}

function stopAmbientSound() {
  if (ambientSourceNode) {
    try { ambientSourceNode.stop(); } catch(e){}
    ambientSourceNode = null;
  }
  if (activeAudioCtx) {
    try { activeAudioCtx.close(); } catch(e){}
    activeAudioCtx = null;
  }
  currentAmbientType = 'none';
}

// =============================================
//  Share Achievement Card Generator
// =============================================
function generateShareCard() {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const width = canvas.width;
  const height = canvas.height;

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0d9488');
  grad.addColorStop(1, '#090e1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('📋 TaskFlow – إنجازي اليومي', width / 2, 60);

  const streak = getStreakData().days;
  ctx.font = '900 48px Inter, sans-serif';
  ctx.fillStyle = '#fb923c';
  ctx.fillText(`${streak} 🔥`, width / 2, 140);
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('أيام سلسلة الإنجاز', width / 2, 170);

  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  ctx.fillStyle = '#2dd4bf';
  ctx.font = '800 36px Inter, sans-serif';
  ctx.fillText(`${pct}%`, width / 2, 230);
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`أُنجزت ${done} من أصل ${total} مهمة`, width / 2, 260);

  const dateStr = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(dateStr, width / 2, 350);

  const modal = document.getElementById('share-card-modal');
  if (modal) modal.classList.add('open');
}

function downloadShareCard() {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `TaskFlow_Achievement_${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL();
  link.click();
  showToast('📥 تم تنزيل بطاقة الإنجاز!', 'success');
}

window.selectCalendarDate = selectCalendarDate;

document.addEventListener('DOMContentLoaded', () => {
  // ---- Calendar navigation ----
  document.getElementById('cal-prev-month')?.addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() - 1);
    renderCalendar();
  });

  document.getElementById('cal-next-month')?.addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() + 1);
    renderCalendar();
  });

  // Jump to Today
  document.getElementById('cal-jump-today')?.addEventListener('click', () => {
    currentCalDate = new Date();
    selectedCalDateStr = new Date().toISOString().slice(0, 10);
    renderCalendar();
  });

  // Quick Add to Selected Date
  document.getElementById('cal-quick-add-btn')?.addEventListener('click', () => {
    // Pre-fill the task form with the selected calendar date then open the modal
    const modal = document.getElementById('task-modal');
    const dueDateInput = document.getElementById('task-due-date');
    if (dueDateInput) dueDateInput.value = selectedCalDateStr;
    if (modal) {
      modal.classList.add('open');
      // Reset other fields
      const titleInput = document.getElementById('task-title');
      if (titleInput) { titleInput.value = ''; titleInput.focus(); }
    }
  });

  // Calendar filter tabs
  document.getElementById('cal-filter-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.cal-filter-tab');
    if (!btn) return;
    document.querySelectorAll('.cal-filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calendarFilter = btn.dataset.filter;
    renderSelectedCalDateTasks();
  });

  document.getElementById('ai-subtask-btn')?.addEventListener('click', generateAISubtasks);

  document.getElementById('open-focus-modal-btn')?.addEventListener('click', () => {
    document.getElementById('focus-fullscreen-modal')?.classList.add('open');
    updatePomoUI();
  });

  document.getElementById('close-focus-modal-btn')?.addEventListener('click', () => {
    document.getElementById('focus-fullscreen-modal')?.classList.remove('open');
    stopAmbientSound();
  });

  document.getElementById('focus-modal-toggle-btn')?.addEventListener('click', togglePomoTimer);
  document.getElementById('focus-modal-reset-btn')?.addEventListener('click', resetPomoTimer);

  document.querySelectorAll('.ambient-sound-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ambient-sound-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      startAmbientSound(btn.dataset.sound);
    });
  });

  document.getElementById('share-stats-btn')?.addEventListener('click', generateShareCard);
  document.getElementById('share-modal-close-btn')?.addEventListener('click', () => {
    document.getElementById('share-card-modal')?.classList.remove('open');
  });
  document.getElementById('download-share-card-btn')?.addEventListener('click', downloadShareCard);

  // ---- Trash & Snapshots Modals ----
  document.getElementById('open-trash-btn')?.addEventListener('click', () => {
    renderTrashUI();
    document.getElementById('trash-modal')?.classList.add('open');
  });
  document.getElementById('trash-close-btn')?.addEventListener('click', () => {
    document.getElementById('trash-modal')?.classList.remove('open');
  });
  document.getElementById('empty-trash-btn')?.addEventListener('click', emptyTrash);

  document.getElementById('open-snapshots-btn')?.addEventListener('click', () => {
    renderSnapshotsUI();
    document.getElementById('snapshots-modal')?.classList.add('open');
  });
  document.getElementById('snapshots-close-btn')?.addEventListener('click', () => {
    document.getElementById('snapshots-modal')?.classList.remove('open');
  });

  // ---- PIN Security ----
  document.getElementById('toggle-pin-btn')?.addEventListener('click', togglePINSetting);
  document.getElementById('pin-submit-btn')?.addEventListener('click', verifyPINInput);
  document.getElementById('pin-digit-input')?.addEventListener('keyup', (e) => {
    if (e.target.value.trim().length === 4) verifyPINInput();
  });
});

