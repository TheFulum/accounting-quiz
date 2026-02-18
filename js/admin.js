// ═══════════════════════════════════════
// ЛОГИКА АДМИНКИ
// ═══════════════════════════════════════

const GITHUB_OWNER  = 'TheFulum';
const GITHUB_REPO   = 'accounting-quiz';
const GITHUB_FILE   = 'questions.json';
const GITHUB_BRANCH = 'master';

let questionsData = { questions: [] };
let fileSha = '';
let hasChanges = false;
let searchQuery = '';

// ── ТОКЕН ──
function getToken() {
  return localStorage.getItem('gh_token') || '';
}

function handleHashToken() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    const token = hash.slice(1);
    if (token.startsWith('ghp_') || token.startsWith('github_pat_') || token.length > 20) {
      localStorage.setItem('gh_token', token);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}

// ── API ──
async function apiGet() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${getToken()}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  fileSha = data.sha;
  // Декодируем base64 с поддержкой UTF-8 (кириллица)
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
  const text   = new TextDecoder('utf-8').decode(bytes);
  const json   = JSON.parse(text);
  return json;
}

async function apiPut(content, message) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  // Кодируем в base64 с поддержкой UTF-8 (кириллица)
  const jsonStr = JSON.stringify(content, null, 2);
  const encoded = new TextEncoder().encode(jsonStr);
  const binStr  = Array.from(encoded, b => String.fromCharCode(b)).join('');
  const body = {
    message,
    content: btoa(binStr),
    sha: fileSha,
    branch: GITHUB_BRANCH,
  };
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${getToken()}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  const result = await resp.json();
  fileSha = result.content.sha;
}

// ── UI УВЕДОМЛЕНИЯ ──
function showToast(msg, type = 'success') {
  const container = document.getElementById('toastContainer');
  const id = 'toast_' + Date.now();
  const colors = { success: 'var(--success)', danger: 'var(--danger)', warning: 'var(--warning)' };
  const icons  = { success: '✓', danger: '✕', warning: '⚠' };
  const html = `
    <div id="${id}" style="
      background:var(--bg-card);border:1px solid var(--border);
      border-left:3px solid ${colors[type]};
      border-radius:var(--radius);padding:12px 16px;
      box-shadow:var(--shadow-md);display:flex;gap:10px;
      align-items:center;min-width:260px;max-width:380px;
      animation:cardIn 0.25s ease;font-size:0.87rem;
    ">
      <span style="color:${colors[type]};font-weight:700;flex-shrink:0">${icons[type]}</span>
      <span style="color:var(--text)">${msg}</span>
    </div>`;
  container.insertAdjacentHTML('beforeend', html);
  setTimeout(() => { document.getElementById(id)?.remove(); }, 3500);
}

function markChanged() {
  hasChanges = true;
  document.getElementById('unsavedBadge').style.display = 'inline-flex';
  document.getElementById('saveBtnTop').disabled = false;
}

function clearChanged() {
  hasChanges = false;
  document.getElementById('unsavedBadge').style.display = 'none';
}

// ── АВТОРИЗАЦИЯ ──
function showAuth() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('adminPanel').style.display  = 'none';
}

function hideAuth() {
  document.getElementById('authScreen').style.display  = 'none';
  document.getElementById('adminPanel').style.display  = 'block';
}

async function doLogin(token) {
  if (!token) return showToast('Введите токен', 'warning');
  localStorage.setItem('gh_token', token);
  await loadData();
}

function doLogout() {
  localStorage.removeItem('gh_token');
  showAuth();
}

// ── ЗАГРУЗКА ──
async function loadData() {
  if (!getToken()) return showAuth();
  setLoading(true);
  try {
    questionsData = await apiGet();
    hideAuth();
    renderList();
    updateCounter();
    clearChanged();
    document.getElementById('saveBtnTop').disabled = true;
  } catch (e) {
    showToast('Ошибка загрузки: ' + e.message, 'danger');
    if (e.message.includes('401') || e.message.includes('Bad credentials')) {
      localStorage.removeItem('gh_token');
      showAuth();
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(state) {
  const el = document.getElementById('loadingIndicator');
  if (el) el.style.display = state ? 'flex' : 'none';
}

// ── Привязывает обработчики к одной строке варианта ответа ──
function bindOptionRowEvents(row, qidx) {
  // Удаляем старые обработчики через замену клонированием
  const oldDel  = row.querySelector('.q-opt-del');
  const oldText = row.querySelector('.q-option-input');
  const oldRadio = row.querySelector('.q-correct-radio');

  if (oldDel) {
    const newDel = oldDel.cloneNode(true);
    oldDel.replaceWith(newDel);
    newDel.addEventListener('click', () => {
      const q        = questionsData.questions[qidx];
      const editorEl = document.getElementById(`opts_${qidx}`);
      const allRows  = editorEl.querySelectorAll('.option-editor-row');
      if (allRows.length <= 2) return showToast('Минимум 2 варианта ответа', 'warning');

      const optI     = parseInt(row.dataset.optrow);
      const wasRight = row.querySelector('.q-correct-radio').checked;
      q.options.splice(optI, 1);
      row.remove();

      if (wasRight) q.correct = 0;
      else if (q.correct > optI) q.correct--;

      reindexOptions(editorEl, qidx);
      editorEl.querySelectorAll('.q-correct-radio').forEach((r, i) => { r.checked = (i === q.correct); });
      editorEl.querySelectorAll('.option-editor-row').forEach(r => bindOptionRowEvents(r, qidx));
      markChanged();
    });
  }

  if (oldText) {
    const newText = oldText.cloneNode(true);
    oldText.replaceWith(newText);
    newText.addEventListener('input', () => {
      const optI = parseInt(newText.dataset.optidx);
      questionsData.questions[qidx].options[optI].label = newText.value;
      markChanged();
    });
  }

  if (oldRadio) {
    const newRadio = oldRadio.cloneNode(true);
    oldRadio.replaceWith(newRadio);
    newRadio.addEventListener('change', () => {
      questionsData.questions[qidx].correct = parseInt(newRadio.value);
      markChanged();
    });
  }
}

// ── РЕНДЕР СПИСКА ──
function renderList() {
  const container = document.getElementById('questionsList');
  const q = questionsData.questions || [];
  const filtered = q.filter(item =>
    !searchQuery || item.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Вопросы не найдены</div><div class="empty-state-text">${searchQuery ? 'Попробуйте другой запрос' : 'Добавьте первый вопрос'}</div></div>`;
    return;
  }

  container.innerHTML = filtered.map((item, i) => {
    const origIdx = q.indexOf(item);
    return renderQuestionItem(item, origIdx);
  }).join('');

  // Вешаем обработчики
  container.querySelectorAll('.q-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.admin-q-card').querySelector('.q-body');
      const expanded = body.style.display !== 'none';
      body.style.display = expanded ? 'none' : 'block';
      btn.querySelector('.q-arrow').style.transform = expanded ? '' : 'rotate(180deg)';
    });
  });

  container.querySelectorAll('.q-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      deleteQuestion(idx);
    });
  });

  // Обработчики вариантов ответа (текст, радио, удаление) — через bindOptionRowEvents
  container.querySelectorAll('.option-editor-row').forEach(row => {
    const qidx = parseInt(row.querySelector('[data-qidx]')?.dataset.qidx ?? -1);
    if (qidx >= 0) bindOptionRowEvents(row, qidx);
  });

  container.querySelectorAll('.q-changetype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx  = parseInt(btn.dataset.qidx);
      const type = btn.dataset.type;
      questionsData.questions[idx].changeType = type;
      btn.closest('.change-pills-row').querySelectorAll('.q-changetype-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      markChanged();
    });
  });

  // Автосохранение полей при изменении
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const idx   = parseInt(input.dataset.qidx);
      const field = input.dataset.field;
      const optI  = input.dataset.optidx;
      if (optI !== undefined) {
        questionsData.questions[idx].options[parseInt(optI)].label = input.value;
      } else {
        questionsData.questions[idx][field] = input.value;
      }
      markChanged();
    });
  });

  // ── ДОБАВИТЬ ВАРИАНТ ответа ──
  container.querySelectorAll('.q-opt-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const qidx    = parseInt(btn.dataset.qidx);
      const q       = questionsData.questions[qidx];
      const newOi   = q.options.length;
      q.options.push({ label: '' });

      const editorEl = document.getElementById(`opts_${qidx}`);
      editorEl.insertAdjacentHTML('beforeend', renderOptionRow({ label: '' }, newOi, qidx));

      // Вешаем обработчики на новую строку
      const newRow = editorEl.lastElementChild;
      bindOptionRowEvents(newRow, qidx);
      markChanged();
    });
  });

  // ── УДАЛИТЬ ВАРИАНТ ответа ──
  container.querySelectorAll('.q-opt-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const qidx  = parseInt(btn.dataset.qidx);
      const q     = questionsData.questions[qidx];
      const editorEl = document.getElementById(`opts_${qidx}`);
      const allRows  = editorEl.querySelectorAll('.option-editor-row');

      if (allRows.length <= 2) {
        return showToast('Минимум 2 варианта ответа', 'warning');
      }

      const rowEl    = btn.closest('.option-editor-row');
      const optI     = parseInt(rowEl.dataset.optrow);
      const wasRight = rowEl.querySelector('.q-correct-radio').checked;

      // Удаляем из данных и из DOM
      q.options.splice(optI, 1);
      rowEl.remove();

      // Пересчитываем правильный ответ если нужно
      if (wasRight) {
        q.correct = 0;
      } else if (q.correct > optI) {
        q.correct--;
      }

      // Переиндексируем DOM и данные
      reindexOptions(editorEl, qidx);
      // Обновляем состояние радиокнопок
      editorEl.querySelectorAll('.q-correct-radio').forEach((r, i) => {
        r.checked = (i === q.correct);
      });

      // Перевешиваем обработчики на все строки
      editorEl.querySelectorAll('.option-editor-row').forEach(row => {
        bindOptionRowEvents(row, qidx);
      });

      markChanged();
    });
  });
}

function renderOptionRow(opt, oi, origIdx) {
  return `
    <div class="option-editor-row" data-optrow="${oi}">
      <input type="radio" class="q-correct-radio" name="correct_${origIdx}" value="${oi}"
        data-qidx="${origIdx}" ${questionsData.questions[origIdx].correct === oi ? 'checked' : ''}
        title="Правильный ответ">
      <input type="text" class="q-input q-option-input" data-field="option"
        data-optidx="${oi}" data-qidx="${origIdx}" value="${opt.label.replace(/"/g, '&quot;')}">
      <button type="button" class="q-opt-del" data-qidx="${origIdx}" data-optrow="${oi}"
        title="Удалить вариант"
        style="background:none;border:1px solid transparent;border-radius:var(--radius);
               cursor:pointer;color:var(--danger);padding:4px 8px;flex-shrink:0;
               font-size:0.95rem;line-height:1;transition:all var(--transition)"
        onmouseover="this.style.background='var(--danger-bg)';this.style.borderColor='var(--danger)'"
        onmouseout="this.style.background='none';this.style.borderColor='transparent'">✕</button>
    </div>`;
}

function reindexOptions(editorEl, origIdx) {
  editorEl.querySelectorAll('.option-editor-row').forEach((row, i) => {
    row.dataset.optrow = i;
    const radio = row.querySelector('.q-correct-radio');
    const input = row.querySelector('.q-option-input');
    const delbtn = row.querySelector('.q-opt-del');
    radio.value = i;
    radio.dataset.qidx = origIdx;
    input.dataset.optidx = i;
    input.dataset.qidx = origIdx;
    delbtn.dataset.qidx = origIdx;
    delbtn.dataset.optrow = i;
  });
}

function renderQuestionItem(item, origIdx) {
  const changeTypeOptions = item.changeTypeOptions || ['1', '2', '3', '4'];
  return `
  <div class="admin-q-card" data-id="${origIdx}">
    <div class="admin-q-header">
      <button class="q-toggle" type="button">
        <span class="q-num">#${origIdx + 1}</span>
        <span class="q-topic-badge">${item.topic || 'Прочее'}</span>
        <span class="q-preview">${item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text}</span>
        <span class="q-arrow" style="margin-left:auto;transition:transform 0.2s;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 5.5l6.5 6.5 6.5-6.5"/></svg>
        </span>
      </button>
      <button class="q-delete nav-btn" style="color:var(--danger);border-color:var(--danger-bg);flex-shrink:0" data-idx="${origIdx}" title="Удалить">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
        Удалить
      </button>
    </div>
    <div class="q-body" style="display:none">
      <div class="q-field-row">
        <label class="q-field-label">Текст вопроса</label>
        <textarea class="q-textarea" data-field="text" data-qidx="${origIdx}" rows="3">${item.text}</textarea>
      </div>
      <div class="q-field-row">
        <label class="q-field-label">Тема</label>
        <input type="text" class="q-input" data-field="topic" data-qidx="${origIdx}" value="${item.topic || ''}">
      </div>
      <div class="q-field-row">
        <label class="q-field-label">
          Варианты ответа
          <span style="color:var(--text-subtle);font-weight:400;text-transform:none;letter-spacing:0">— радиокнопка = правильный ответ</span>
        </label>
        <div class="options-editor" id="opts_${origIdx}">
          ${item.options.map((opt, oi) => renderOptionRow(opt, oi, origIdx)).join('')}
        </div>
        <button type="button" class="q-opt-add nav-btn" data-qidx="${origIdx}"
          style="margin-top:8px;font-size:0.78rem">
          + Добавить вариант
        </button>
      </div>
      <div class="q-field-row">
        <label class="q-field-label">Тип изменений (правильный)</label>
        <div class="change-pills-row">
          ${changeTypeOptions.map(ct => `
            <button class="change-pill q-changetype-btn${item.changeType === ct ? ' selected' : ''}" data-qidx="${origIdx}" data-type="${ct}">${ct}</button>
          `).join('')}
        </div>
      </div>
      <div class="q-field-row">
        <label class="q-field-label">Пояснение</label>
        <textarea class="q-textarea" data-field="explanation" data-qidx="${origIdx}" rows="2">${item.explanation || ''}</textarea>
      </div>
    </div>
  </div>`;
}

function updateCounter() {
  const el = document.getElementById('questionCount');
  if (el) el.textContent = (questionsData.questions || []).length;
}

// ── УДАЛЕНИЕ ──
function deleteQuestion(idx) {
  const q = questionsData.questions[idx];
  if (!confirm(`Удалить вопрос:\n«${q.text.slice(0, 80)}»?`)) return;
  questionsData.questions.splice(idx, 1);
  markChanged();
  renderList();
  updateCounter();
  showToast('Вопрос удалён', 'warning');
}

// ── ДОБАВЛЕНИЕ ──
function showAddForm() {
  const wrap = document.getElementById('addFormWrap');
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Сбрасываем форму в исходное состояние
  document.getElementById('newQuestionForm').reset();
  document.querySelectorAll('.new-changetype-btn').forEach(b => b.classList.remove('selected'));

  // Инициализируем кастомный дропдаун тем
  const topics = [...new Set((questionsData.questions || []).map(q => q.topic || 'Прочее'))].sort();
  initTopicCombo(topics);
}

// ── КАСТОМНЫЙ ДРОПДАУН ТЕМ ──
function initTopicCombo(allTopics) {
  const input    = document.getElementById('newTopicInput');
  const dropdown = document.getElementById('topicDropdown');
  if (!input || !dropdown) return;

  let highlighted = -1;

  function highlight(str, query) {
    if (!query) return str;
    const idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return str;
    return str.slice(0, idx) + '<mark>' + str.slice(idx, idx + query.length) + '</mark>' + str.slice(idx + query.length);
  }

  function renderDropdown(query) {
    const filtered = query
      ? allTopics.filter(t => t.toLowerCase().includes(query.toLowerCase()))
      : allTopics;
    highlighted = -1;

    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="topic-dropdown-empty">Новая тема — будет создана автоматически</div>';
    } else {
      dropdown.innerHTML = filtered.map((t, i) =>
        `<div class="topic-option" data-idx="${i}" data-value="${t}">${highlight(t, query)}</div>`
      ).join('');

      dropdown.querySelectorAll('.topic-option').forEach(opt => {
        opt.addEventListener('mousedown', e => {
          e.preventDefault();
          selectTopic(opt.dataset.value);
        });
        opt.addEventListener('touchend', e => {
          e.preventDefault();
          selectTopic(opt.dataset.value);
        });
      });
    }
    dropdown.classList.add('open');
  }

  function selectTopic(value) {
    input.value = value;
    dropdown.classList.remove('open');
    highlighted = -1;
  }

  function updateHighlight(items, newIdx) {
    items.forEach(el => el.classList.remove('highlighted'));
    highlighted = newIdx;
    if (highlighted >= 0 && highlighted < items.length) {
      items[highlighted].classList.add('highlighted');
      items[highlighted].scrollIntoView({ block: 'nearest' });
    }
  }

  input.addEventListener('input',  () => renderDropdown(input.value.trim()));
  input.addEventListener('focus',  () => renderDropdown(input.value.trim()));
  input.addEventListener('blur',   () => setTimeout(() => dropdown.classList.remove('open'), 150));

  input.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.topic-option')];
    if (!dropdown.classList.contains('open') || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateHighlight(items, Math.min(highlighted + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateHighlight(items, Math.max(highlighted - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0) selectTopic(items[highlighted].dataset.value);
      else dropdown.classList.remove('open');
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('open');
    }
  });
}

function hideAddForm() {
  document.getElementById('addFormWrap').style.display = 'none';
  document.getElementById('newQuestionForm').reset();
  document.querySelectorAll('.new-changetype-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('topicDropdown')?.classList.remove('open');
}

function submitNewQuestion() {
  const form  = document.getElementById('newQuestionForm');
  const text  = form.querySelector('[name="q_text"]').value.trim();
  const topic = form.querySelector('[name="q_topic"]').value.trim();
  const exp   = form.querySelector('[name="q_explanation"]').value.trim();

  // Варианты ответа
  const opts  = [];
  let correct = null;
  form.querySelectorAll('.new-option-row').forEach((row, i) => {
    const val   = row.querySelector('.new-opt-input').value.trim();
    const radio = row.querySelector('.new-opt-radio');
    if (radio.checked) correct = i;
    if (val) opts.push({ label: val });
  });

  // Правильный тип изменений
  const changeType = form.querySelector('.new-changetype-btn.selected')?.dataset.type;

  // Варианты типов для показа в тесте
  const changeTypeOptions = [];
  form.querySelectorAll('[name="cto"]:checked').forEach(cb => changeTypeOptions.push(cb.value));

  // Валидация
  if (!text)                   return showToast('Введите текст вопроса', 'warning');
  if (!topic)                  return showToast('Укажите тему вопроса', 'warning');
  if (opts.length < 2)         return showToast('Добавьте минимум 2 варианта ответа', 'warning');
  if (correct === null)        return showToast('Отметьте правильный вариант ответа', 'warning');
  if (!changeType)             return showToast('Выберите правильный тип изменений', 'warning');
  if (changeTypeOptions.length < 2) return showToast('Отметьте минимум 2 варианта типов для теста', 'warning');
  if (!changeTypeOptions.includes(changeType))
    return showToast('Правильный тип должен быть среди вариантов для теста', 'warning');

  const maxId = (questionsData.questions || []).reduce((m, q) => Math.max(m, q.id || 0), 0);

  const newQ = {
    id:                maxId + 1,
    text,
    topic,
    options:           opts,
    correct,
    changeType,
    changeTypeOptions,
    explanation:       exp,
  };

  questionsData.questions.push(newQ);
  markChanged();
  renderList();
  updateCounter();
  hideAddForm();
  showToast(`Вопрос #${newQ.id} добавлен!`, 'success');
}

// ── СОХРАНЕНИЕ ──
async function saveChanges() {
  const btn = document.getElementById('saveBtnTop');
  btn.disabled = true;
  btn.textContent = 'Сохранение…';

  try {
    await apiPut(questionsData, `Обновление questions.json (${new Date().toLocaleString('ru')})`);
    clearChanged();
    showToast('Изменения сохранены в репозиторий!', 'success');
  } catch (e) {
    showToast('Ошибка сохранения: ' + e.message, 'danger');
  } finally {
    btn.textContent = 'Сохранить изменения';
    btn.disabled = !hasChanges;
  }
}

// ── ИНИЦИАЛИЗАЦИЯ ──
document.addEventListener('DOMContentLoaded', () => {
  handleHashToken();

  // Кнопка входа
  document.getElementById('loginBtn')?.addEventListener('click', () => {
    const token = document.getElementById('tokenInput').value.trim();
    doLogin(token);
  });

  document.getElementById('tokenInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });

  // Выход
  document.getElementById('logoutBtn')?.addEventListener('click', doLogout);

  // Сохранить
  document.getElementById('saveBtnTop')?.addEventListener('click', saveChanges);

  // Добавить вопрос
  document.getElementById('addQuestionBtn')?.addEventListener('click', showAddForm);
  document.getElementById('cancelAddBtn')?.addEventListener('click', hideAddForm);
  document.getElementById('submitNewBtn')?.addEventListener('click', submitNewQuestion);

  // Типы изменений в форме добавления — делегирование на контейнер
  document.getElementById('newChangeTypePills')?.addEventListener('click', e => {
    const btn = e.target.closest('.new-changetype-btn');
    if (!btn) return;
    document.querySelectorAll('.new-changetype-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  // Поиск
  document.getElementById('adminSearch')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderList();
  });

  // Авто-логин
  if (getToken()) {
    loadData();
  } else {
    showAuth();
  }
});
