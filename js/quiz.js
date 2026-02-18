// ═══════════════════════════════════════
// ЛОГИКА ТЕСТА
// ═══════════════════════════════════════

const TOTAL_QUESTIONS = 20;
const MAX_PER_TOPIC   = 3;   // лимит вопросов из одной темы
const TIME_LIMIT      = 20 * 60; // 20 минут в секундах

let allQuestions = [];
let sessionQuestions = [];
let currentIndex  = 0;
let answers       = [];      // { optionIndex, changeType }
let timerInterval = null;
let elapsedSeconds = 0;

// ── УТИЛИТЫ ──
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Сбалансированная выборка: не более MAX_PER_TOPIC из одной темы.
 * Алгоритм:
 *  1. Перемешиваем все вопросы.
 *  2. Идём по ним и берём, пока не набрали TOTAL_QUESTIONS,
 *     пропуская тему, если лимит уже достигнут.
 *  3. Если вопросов с учётом лимита меньше TOTAL_QUESTIONS
 *     (например, тем мало) — поднимаем лимит и повторяем.
 */
function selectBalancedQuestions(questions, total, maxPerTopic) {
  const shuffled = shuffle(questions);
  const topicCount = {};
  const selected = [];
  let limit = maxPerTopic;

  while (selected.length < total) {
    // Сбрасываем и пробуем с текущим лимитом
    Object.keys(topicCount).forEach(k => { topicCount[k] = 0; });
    selected.length = 0;

    for (const q of shuffled) {
      if (selected.length >= total) break;
      const t = q.topic || 'Прочее';
      if ((topicCount[t] || 0) >= limit) continue;
      topicCount[t] = (topicCount[t] || 0) + 1;
      selected.push(q);
    }

    if (selected.length >= total) break;
    limit++; // не хватило — ослабляем ограничение
    if (limit > questions.length) break; // крайний случай
  }

  // Если всё равно не набрали (вопросов в базе меньше total)
  if (selected.length < total) {
    return shuffle(questions).slice(0, Math.min(total, questions.length));
  }

  return shuffle(selected); // ещё раз перемешиваем финальный набор
}

// ── ТАЙМЕР ──
function startTimer() {
  elapsedSeconds = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
    if (elapsedSeconds >= TIME_LIMIT) {
      stopTimer();
      showTimeExpiredBanner();
      setTimeout(() => finishQuiz(true), 2000);
    }
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
}

function updateTimerDisplay() {
  const el = document.getElementById('quizTimer');
  if (!el) return;
  const remaining = TIME_LIMIT - elapsedSeconds;
  const r = Math.max(0, remaining);
  const m = Math.floor(r / 60);
  const s = r % 60;
  el.textContent = `${pad(m)}:${pad(s)}`;

  // Предупреждения
  const timerWrap = el.closest('.quiz-timer');
  if (timerWrap) {
    timerWrap.classList.remove('timer-warning', 'timer-danger');
    if (r <= 60)  timerWrap.classList.add('timer-danger');
    else if (r <= 5 * 60) timerWrap.classList.add('timer-warning');
  }
}

function showTimeExpiredBanner() {
  const card = document.getElementById('questionCard');
  if (!card) return;
  const banner = document.createElement('div');
  banner.className = 'time-expired-banner';
  banner.innerHTML = `⏰ Время вышло! Тест будет завершён автоматически…`;
  card.prepend(banner);

  const btn = document.getElementById('nextBtn');
  if (btn) {
    btn.textContent = 'Завершение…';
    btn.disabled = true;
  }
}

// ── РЕНДЕР ВОПРОСА ──
function renderQuestion(index) {
  const q = sessionQuestions[index];
  const card = document.getElementById('questionCard');
  const ans  = answers[index] || {};

  card.innerHTML = `
    <div class="question-topic">${q.topic || 'Общее'}</div>
    <div class="question-number">Вопрос ${index + 1} из ${sessionQuestions.length}</div>
    <div class="question-text">${q.text}</div>
    <div class="options-label">Бухгалтерская проводка</div>
    <div class="options-list" id="optionsList">
      ${q.options.map((opt, i) => `
        <label class="option-item${ans.optionIndex === i ? ' selected' : ''}" data-idx="${i}">
          <input type="radio" name="option" value="${i}" ${ans.optionIndex === i ? 'checked' : ''}>
          <span class="option-radio-circle"></span>
          <span class="option-label">${opt.label}</span>
        </label>
      `).join('')}
    </div>
    <div class="change-type-section">
      <div class="options-label">Тип изменений балансового уравнения</div>
      <div class="change-type-pills" id="changePills">
        ${q.changeTypeOptions.map(ct => `
          <button class="change-pill${ans.changeType === ct ? ' selected' : ''}" data-type="${ct}">${ct}</button>
        `).join('')}
      </div>
    </div>
  `;

  // Клик по опции
  card.querySelectorAll('.option-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      if (!answers[index]) answers[index] = {};
      answers[index].optionIndex = idx;
      card.querySelectorAll('.option-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      item.querySelector('input').checked = true;
      checkNextBtn();
    });
  });

  // Клик по типу изменений
  card.querySelectorAll('.change-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      if (!answers[index]) answers[index] = {};
      answers[index].changeType = pill.dataset.type;
      card.querySelectorAll('.change-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      checkNextBtn();
    });
  });

  updateProgress(index);
  checkNextBtn();
}

function checkNextBtn() {
  const btn = document.getElementById('nextBtn');
  if (!btn) return;
  const ans = answers[currentIndex] || {};
  const ready = ans.optionIndex !== undefined && ans.changeType !== undefined;
  btn.disabled = !ready;
  btn.textContent = currentIndex < sessionQuestions.length - 1
    ? 'Следующий вопрос →'
    : 'Завершить тест';
}

function updateProgress(index) {
  const fill  = document.getElementById('progressFill');
  const label = document.getElementById('progressLabel');
  const pct   = Math.round(((index + 1) / sessionQuestions.length) * 100);
  if (fill)  fill.style.width  = pct + '%';
  if (label) label.textContent = `${index + 1} / ${sessionQuestions.length}`;
}

// ── СЛЕДУЮЩИЙ ВОПРОС ──
function nextQuestion() {
  const btn = document.getElementById('nextBtn');
  if (btn) btn.disabled = true;

  if (currentIndex < sessionQuestions.length - 1) {
    currentIndex++;
    renderQuestion(currentIndex);
  } else {
    finishQuiz();
  }
}

// ── ЗАВЕРШЕНИЕ ──
function finishQuiz(timeExpired) {
  stopTimer();
  const duration = elapsedSeconds;

  let correct = 0;
  sessionQuestions.forEach((q, i) => {
    const ans = answers[i] || {};
    if (ans.optionIndex === q.correct && ans.changeType === q.changeType) correct++;
  });

  const errorsData = buildErrors();

  // Сохраняем в историю (теперь с errors для детального просмотра)
  const history = JSON.parse(localStorage.getItem('quiz_history') || '[]');
  history.unshift({
    date:    new Date().toISOString(),
    score:   correct,
    total:   sessionQuestions.length,
    time:    duration,
    percent: Math.round((correct / sessionQuestions.length) * 100),
    expired: timeExpired,
    errors:  errorsData,
  });
  localStorage.setItem('quiz_history', JSON.stringify(history.slice(0, 50)));

  // Сохраняем результат сессии для экрана результатов
  sessionStorage.setItem('last_result', JSON.stringify({
    score:    correct,
    total:    sessionQuestions.length,
    time:     duration,
    percent:  Math.round((correct / sessionQuestions.length) * 100),
    expired:  timeExpired,
    errors:   errorsData,
  }));

  window.location.href = 'result.html';
}

function buildErrors() {
  const errors = [];
  sessionQuestions.forEach((q, i) => {
    const ans = answers[i] || {};
    const optOk  = ans.optionIndex === q.correct;
    const typeOk = ans.changeType === q.changeType;
    if (!optOk || !typeOk) {
      errors.push({
        text:         q.text,
        yourOption:   ans.optionIndex !== undefined ? q.options[ans.optionIndex]?.label : '(не выбрано)',
        rightOption:  q.options[q.correct]?.label,
        yourType:     ans.changeType || '(не выбрано)',
        rightType:    q.changeType,
        explanation:  q.explanation || '',
        optOk,
        typeOk,
      });
    }
  });
  return errors;
}

// ── ЗАГРУЗКА И СТАРТ ──
async function loadAndStart() {
  document.getElementById('quizArea').style.display   = 'none';
  document.getElementById('loadingArea').style.display = 'flex';

  try {
    const resp = await fetch('questions.json?v=' + Date.now());
    const data = await resp.json();
    allQuestions = data.questions || [];

    if (allQuestions.length === 0) throw new Error('Нет вопросов');

    sessionQuestions = selectBalancedQuestions(allQuestions, TOTAL_QUESTIONS, MAX_PER_TOPIC);
    answers = new Array(sessionQuestions.length).fill(null).map(() => ({}));
    currentIndex = 0;

    document.getElementById('loadingArea').style.display = 'none';
    document.getElementById('quizArea').style.display   = 'block';

    renderQuestion(0);
    startTimer();
  } catch (e) {
    document.getElementById('loadingArea').innerHTML = `
      <div style="text-align:center;color:var(--danger)">
        <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
        <div style="font-weight:600">Не удалось загрузить вопросы</div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">${e.message}</div>
        <a href="index.html" class="btn-outline" style="margin-top:16px;display:inline-flex">← На главную</a>
      </div>`;
  }
}

// ── ИНИЦИАЛИЗАЦИЯ ──
document.addEventListener('DOMContentLoaded', () => {
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) nextBtn.addEventListener('click', nextQuestion);

  loadAndStart();
});
