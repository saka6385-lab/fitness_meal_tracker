import * as db from './db.js';
import { computeTargets, ACTIVITY_LABELS, GOAL_LABELS } from './calc.js';
import { resizeImage, analyzeFoodPhoto, PROVIDERS } from './ai.js';

const app = document.getElementById('app');

const DEFAULT_TARGETS = { calories: 2400, protein: 150, fat: 70, carbs: 280 };
const DEFAULT_PROVIDER = 'anthropic';

let cache = {
  profile: null,
  targets: null,
  provider: DEFAULT_PROVIDER,
  apiKeys: { anthropic: '', gemini: '' },
  models: { anthropic: PROVIDERS.anthropic.models[1].value, gemini: PROVIDERS.gemini.models[0].value },
  onboarded: false,
};

async function loadCache() {
  const s = await db.getAllSettings();
  cache.profile = s.profile ?? null;
  cache.targets = s.targets ?? DEFAULT_TARGETS;
  cache.provider = s.provider ?? DEFAULT_PROVIDER;
  cache.apiKeys = {
    anthropic: s.apiKeyAnthropic ?? '',
    gemini: s.apiKeyGemini ?? '',
  };
  cache.models = {
    anthropic: s.modelAnthropic ?? PROVIDERS.anthropic.models[1].value,
    gemini: s.modelGemini ?? PROVIDERS.gemini.models[0].value,
  };
  cache.onboarded = !!s.onboarded;
}

function currentApiKey() {
  return cache.apiKeys[cache.provider];
}

function currentModel() {
  return cache.models[cache.provider];
}

// ---------- helpers ----------

function todayKey() {
  return db.dateKeyFor(new Date());
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  const isToday = dateKey === todayKey();
  return `${m}月${d}日(${weekday})${isToday ? ' ・ 今日' : ''}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sumMeals(meals) {
  return meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      fat: acc.fat + (m.fat || 0),
      carbs: acc.carbs + (m.carbs || 0),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
}

function pct(current, target) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- navigation ----------

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash || 'dashboard';
}

function navigate(route) {
  location.hash = `/${route}`;
}

function renderNav(active) {
  const items = [
    { route: 'dashboard', glyph: '🏠', label: 'ホーム' },
    { route: 'history', glyph: '📅', label: '履歴' },
    { route: 'log', glyph: '＋', label: '記録', fab: true },
    { route: 'settings', glyph: '⚙️', label: '設定' },
  ];
  return `
    <nav class="bottom-nav">
      ${items
        .map((item) => {
          const isActive = active === item.route || (active === 'history-day' && item.route === 'history');
          if (item.fab) {
            return `<button class="nav-btn fab" data-route="${item.route}"><span class="glyph">${item.glyph}</span></button>`;
          }
          return `<button class="nav-btn ${isActive ? 'active' : ''}" data-route="${item.route}">
            <span class="glyph">${item.glyph}</span><span>${item.label}</span>
          </button>`;
        })
        .join('')}
    </nav>`;
}

function attachNav() {
  app.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
}

// ---------- onboarding ----------

function renderOnboarding() {
  app.innerHTML = `
    <div class="header">
      <h1>MACRO GAINS</h1>
      <div class="subtitle">まずは体格と目標を教えてください</div>
    </div>
    <div class="screen">
      ${profileFormHtml({})}
      <button class="btn" id="start-btn">はじめる</button>
    </div>
  `;
  attachProfileFormEvents({
    onSubmit: async (profile, targets) => {
      await db.setSetting('profile', profile);
      await db.setSetting('targets', targets);
      await db.setSetting('onboarded', true);
      await loadCache();
      navigate('settings');
      // after onboarding, land on settings so the user can add their API key
      history.replaceState(null, '', '#/settings?welcome=1');
      render();
    },
    submitButtonId: 'start-btn',
  });
}

function profileFormHtml(existing) {
  const p = existing || {};
  const sex = p.sex || 'male';
  const activity = p.activity || 'moderate';
  const goal = p.goal || 'bulk';
  return `
    <div class="card">
      <div class="card-title">体格</div>
      <div class="field-row">
        <div class="field">
          <label>体重 (kg)</label>
          <input type="number" id="f-weight" inputmode="decimal" value="${p.weightKg ?? ''}" placeholder="70">
        </div>
        <div class="field">
          <label>身長 (cm)</label>
          <input type="number" id="f-height" inputmode="decimal" value="${p.heightCm ?? ''}" placeholder="170">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>年齢</label>
          <input type="number" id="f-age" inputmode="numeric" value="${p.age ?? ''}" placeholder="25">
        </div>
        <div class="field">
          <label>性別</label>
          <div class="segmented" id="f-sex">
            <button type="button" data-value="male" class="${sex === 'male' ? 'selected' : ''}">男性</button>
            <button type="button" data-value="female" class="${sex === 'female' ? 'selected' : ''}">女性</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">活動レベル</div>
      <div class="segmented" id="f-activity">
        ${Object.entries(ACTIVITY_LABELS)
          .map(([value, label]) => `<button type="button" data-value="${value}" class="${activity === value ? 'selected' : ''}">${label}</button>`)
          .join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-title">目標</div>
      <div class="segmented" id="f-goal">
        ${Object.entries(GOAL_LABELS)
          .map(([value, label]) => `<button type="button" data-value="${value}" class="${goal === value ? 'selected' : ''}">${label}</button>`)
          .join('')}
      </div>
    </div>
  `;
}

function attachProfileFormEvents({ onSubmit, submitButtonId }) {
  const selectGroup = (id) => {
    const group = document.getElementById(id);
    group.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
    });
  };
  selectGroup('f-sex');
  selectGroup('f-activity');
  selectGroup('f-goal');

  document.getElementById(submitButtonId).addEventListener('click', async () => {
    const weightKg = Number(document.getElementById('f-weight').value);
    const heightCm = Number(document.getElementById('f-height').value);
    const age = Number(document.getElementById('f-age').value);
    if (!weightKg || !heightCm || !age) {
      alert('体重・身長・年齢をすべて入力してください');
      return;
    }
    const sex = document.querySelector('#f-sex button.selected').dataset.value;
    const activity = document.querySelector('#f-activity button.selected').dataset.value;
    const goal = document.querySelector('#f-goal button.selected').dataset.value;
    const profile = { weightKg, heightCm, age, sex, activity, goal };
    const targets = computeTargets(profile);
    await onSubmit(profile, targets);
  });
}

// ---------- dashboard ----------

async function renderDashboard() {
  const key = todayKey();
  const meals = await db.getMealsByDate(key);
  const totals = sumMeals(meals);
  const t = cache.targets;

  const caloriesPct = pct(totals.calories, t.calories);
  const isOver = totals.calories > t.calories;

  app.innerHTML = `
    <div class="header">
      <h1>今日の記録</h1>
      <div class="subtitle">${formatDateLabel(key)}</div>
    </div>
    <div class="screen">
      <div class="card calorie-hero">
        <div class="value">${totals.calories}<small> / ${t.calories} kcal</small></div>
        <div class="label">${isOver ? '目標オーバー気味です' : `残り ${Math.max(0, t.calories - totals.calories)} kcal`}</div>
        <div class="ring-wrap" style="width:100%;">
          <div class="bar-track" style="width:100%;">
            <div class="bar-fill ${isOver ? 'over' : 'calories'}" style="width:${caloriesPct}%"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">PFCバランス</div>
        <div class="macro-row">
          ${macroBarHtml('P タンパク質', totals.protein, t.protein, 'protein')}
          ${macroBarHtml('F 脂質', totals.fat, t.fat, 'fat')}
          ${macroBarHtml('C 炭水化物', totals.carbs, t.carbs, 'carbs')}
        </div>
      </div>

      <div class="section-title">食事一覧</div>
      ${meals.length === 0 ? emptyStateHtml() : `<div class="meal-list">${meals.map(mealItemHtml).join('')}</div>`}
    </div>
    ${renderNav('dashboard')}
  `;
  attachNav();
  attachMealListEvents(meals, () => renderDashboard());
}

function macroBarHtml(label, current, target, colorClass) {
  const p = pct(current, target);
  return `
    <div class="macro-item">
      <div class="macro-label">
        <span class="name">${label}</span>
        <span class="amounts">${Math.round(current)}g / ${Math.round(target)}g</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${colorClass}" style="width:${p}%"></div></div>
    </div>
  `;
}

function emptyStateHtml() {
  return `<div class="empty-state">まだ記録がありません。<br>右下の「＋」から写真を撮って記録しましょう。</div>`;
}

function mealItemHtml(m) {
  return `
    <div class="meal-item" data-id="${m.id}">
      ${m.photo ? `<img class="meal-thumb" src="${m.photo}" alt="">` : `<div class="meal-thumb"></div>`}
      <div class="meal-info">
        <div class="name">${escapeHtml(m.foodName)}</div>
        <div class="macros">${Math.round(m.calories)}kcal ・ P${Math.round(m.protein)} F${Math.round(m.fat)} C${Math.round(m.carbs)}</div>
        <div class="time">${formatTime(m.timestamp)}</div>
      </div>
      <button class="icon-btn" data-delete="${m.id}" aria-label="削除">✕</button>
    </div>
  `;
}

function attachMealListEvents(meals, onChanged) {
  app.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.delete);
      if (!confirm('この記録を削除しますか？')) return;
      await db.deleteMeal(id);
      onChanged();
    });
  });
}

// ---------- log (camera + AI) ----------

let logState = {
  file: null,
  dataUrl: null,
  base64: null,
  mediaType: null,
  ai: null,
  loading: false,
  error: null,
};

function resetLogState() {
  logState = { file: null, dataUrl: null, base64: null, mediaType: null, ai: null, loading: false, error: null };
}

function renderLog() {
  app.innerHTML = `
    <div class="header">
      <h1>食事を記録</h1>
      <div class="subtitle">写真を撮ってAIに解析させるか、手動で入力できます</div>
    </div>
    <div class="screen" id="log-screen"></div>
    ${renderNav('log')}
  `;
  attachNav();
  renderLogScreen();
}

function renderLogScreen() {
  const screen = document.getElementById('log-screen');
  if (!currentApiKey()) {
    screen.innerHTML = `
      <div class="banner info">AI解析を使うには設定画面でAPIキーを登録してください。登録なしでも手動入力で記録できます。</div>
      ${logState.dataUrl ? `<img class="photo-preview" src="${logState.dataUrl}" alt="">` : photoPickerHtml()}
      ${logState.dataUrl ? `<button class="btn secondary" id="retake-btn" style="margin-bottom:14px;">写真を撮り直す</button>` : ''}
      ${manualFormHtml(null)}
      <button class="btn" id="save-btn">保存する</button>
    `;
  } else if (!logState.dataUrl) {
    screen.innerHTML = photoPickerHtml();
  } else {
    screen.innerHTML = `
      <img class="photo-preview" src="${logState.dataUrl}" alt="">
      ${logState.error ? `<div class="banner error">${escapeHtml(logState.error)}</div>` : ''}
      ${
        !logState.ai && !logState.loading
          ? `<button class="btn" id="analyze-btn">✨ AIで解析する</button>
             <button class="btn ghost" id="skip-ai-btn" style="margin-top:10px;">手動で入力する</button>`
          : ''
      }
      ${logState.loading ? `<button class="btn" disabled><span class="spinner"></span> 解析中...</button>` : ''}
      ${logState.ai || logState.skipAi ? manualFormHtml(logState.ai) : ''}
      ${logState.ai || logState.skipAi ? `<button class="btn" id="save-btn">保存する</button>` : ''}
      <button class="btn secondary" id="retake-btn" style="margin-top:10px;">写真を撮り直す</button>
    `;
  }
  attachLogEvents();
}

function photoPickerHtml() {
  return `
    <input type="file" accept="image/*" capture="environment" id="camera-input" style="display:none;">
    <input type="file" accept="image/*" id="gallery-input" style="display:none;">
    <div class="photo-drop">
      <div style="font-size:32px;margin-bottom:8px;">📷</div>
      写真を撮影するか、ギャラリーから選択してください
    </div>
    <button class="btn" id="camera-btn">カメラで撮影</button>
    <button class="btn secondary" id="gallery-btn" style="margin-top:10px;">ギャラリーから選択</button>
  `;
}

function manualFormHtml(ai) {
  const conf = ai?.confidence;
  return `
    <div class="card">
      <div class="card-title">内容を確認・編集</div>
      ${ai ? `<span class="pill ${conf}">AI推定 信頼度: ${conf === 'high' ? '高' : conf === 'low' ? '低' : '中'}</span><div style="height:10px;"></div>` : ''}
      <div class="field">
        <label>料理名</label>
        <input type="text" id="m-name" value="${escapeHtml(ai?.foodName ?? '')}" placeholder="例: 鶏胸肉と白米のプレート">
      </div>
      <div class="field">
        <label>カロリー (kcal)</label>
        <input type="number" id="m-calories" inputmode="decimal" value="${ai?.calories ?? ''}" placeholder="600">
      </div>
      <div class="field-row">
        <div class="field">
          <label>P (g)</label>
          <input type="number" id="m-protein" inputmode="decimal" value="${ai?.protein ?? ''}">
        </div>
        <div class="field">
          <label>F (g)</label>
          <input type="number" id="m-fat" inputmode="decimal" value="${ai?.fat ?? ''}">
        </div>
        <div class="field">
          <label>C (g)</label>
          <input type="number" id="m-carbs" inputmode="decimal" value="${ai?.carbs ?? ''}">
        </div>
      </div>
      ${ai?.description ? `<div class="hint">AIコメント: ${escapeHtml(ai.description)}</div>` : ''}
    </div>
  `;
}

function attachLogEvents() {
  const cameraInput = document.getElementById('camera-input');
  const galleryInput = document.getElementById('gallery-input');
  document.getElementById('camera-btn')?.addEventListener('click', () => cameraInput.click());
  document.getElementById('gallery-btn')?.addEventListener('click', () => galleryInput.click());
  cameraInput?.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
  galleryInput?.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));

  document.getElementById('analyze-btn')?.addEventListener('click', runAnalysis);
  document.getElementById('skip-ai-btn')?.addEventListener('click', () => {
    logState.skipAi = true;
    renderLogScreen();
  });
  document.getElementById('retake-btn')?.addEventListener('click', () => {
    resetLogState();
    renderLogScreen();
  });
  document.getElementById('save-btn')?.addEventListener('click', saveMeal);
}

async function handleFileSelected(file) {
  if (!file) return;
  const { base64, mediaType, dataUrl } = await resizeImage(file);
  logState.file = file;
  logState.base64 = base64;
  logState.mediaType = mediaType;
  logState.dataUrl = dataUrl;
  logState.ai = null;
  logState.error = null;
  renderLogScreen();
}

async function runAnalysis() {
  logState.loading = true;
  logState.error = null;
  renderLogScreen();
  try {
    const result = await analyzeFoodPhoto({
      provider: cache.provider,
      apiKey: currentApiKey(),
      model: currentModel(),
      base64: logState.base64,
      mediaType: logState.mediaType,
    });
    logState.ai = result;
  } catch (err) {
    logState.error = err.message || String(err);
  } finally {
    logState.loading = false;
    renderLogScreen();
  }
}

async function saveMeal() {
  const name = document.getElementById('m-name')?.value.trim();
  const calories = Number(document.getElementById('m-calories')?.value) || 0;
  const protein = Number(document.getElementById('m-protein')?.value) || 0;
  const fat = Number(document.getElementById('m-fat')?.value) || 0;
  const carbs = Number(document.getElementById('m-carbs')?.value) || 0;

  if (!name) {
    alert('料理名を入力してください');
    return;
  }

  const timestamp = Date.now();
  await db.addMeal({
    timestamp,
    dateKey: db.dateKeyFor(timestamp),
    foodName: name,
    calories,
    protein,
    fat,
    carbs,
    photo: logState.dataUrl ?? null,
    source: logState.ai ? 'ai' : 'manual',
  });

  resetLogState();
  navigate('dashboard');
}

// ---------- history ----------

async function renderHistory() {
  const dates = await db.getDatesWithMeals();
  const rows = await Promise.all(
    dates.map(async (dateKey) => {
      const meals = await db.getMealsByDate(dateKey);
      const totals = sumMeals(meals);
      return { dateKey, meals, totals };
    })
  );

  app.innerHTML = `
    <div class="header">
      <h1>履歴</h1>
      <div class="subtitle">これまでの記録</div>
    </div>
    <div class="screen">
      ${
        rows.length === 0
          ? `<div class="empty-state">まだ記録がありません</div>`
          : rows
              .map(
                (r) => `
        <div class="history-day" data-date="${r.dateKey}">
          <div>
            <div class="date">${formatDateLabel(r.dateKey)}</div>
            <div class="summary">${r.totals.calories}kcal ・ P${Math.round(r.totals.protein)} F${Math.round(r.totals.fat)} C${Math.round(r.totals.carbs)} ・ ${r.meals.length}件</div>
          </div>
          <div class="chevron">›</div>
        </div>`
              )
              .join('')
      }
    </div>
    ${renderNav('history')}
  `;
  attachNav();
  app.querySelectorAll('.history-day').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = `/history/${el.dataset.date}`;
    });
  });
}

async function renderHistoryDay(dateKey) {
  const meals = await db.getMealsByDate(dateKey);
  const totals = sumMeals(meals);
  const t = cache.targets;

  app.innerHTML = `
    <div class="header">
      <h1>${formatDateLabel(dateKey)}</h1>
      <div class="subtitle">${totals.calories} / ${t.calories} kcal</div>
    </div>
    <div class="screen">
      <button class="link-btn" id="back-btn">‹ 履歴に戻る</button>
      <div class="card">
        <div class="card-title">PFCバランス</div>
        <div class="macro-row">
          ${macroBarHtml('P タンパク質', totals.protein, t.protein, 'protein')}
          ${macroBarHtml('F 脂質', totals.fat, t.fat, 'fat')}
          ${macroBarHtml('C 炭水化物', totals.carbs, t.carbs, 'carbs')}
        </div>
      </div>
      <div class="section-title">食事一覧</div>
      ${meals.length === 0 ? emptyStateHtml() : `<div class="meal-list">${meals.map(mealItemHtml).join('')}</div>`}
    </div>
    ${renderNav('history-day')}
  `;
  attachNav();
  document.getElementById('back-btn').addEventListener('click', () => navigate('history'));
  attachMealListEvents(meals, () => renderHistoryDay(dateKey));
}

// ---------- settings ----------

function providerCardHtml(provider) {
  const meta = PROVIDERS[provider];
  const key = cache.apiKeys[provider] ?? '';
  const model = cache.models[provider] ?? meta.models[0].value;
  return `
    <div class="segmented" id="s-provider" style="margin-bottom:14px;">
      ${Object.entries(PROVIDERS)
        .map(
          ([value, m]) =>
            `<button type="button" data-value="${value}" class="${value === provider ? 'selected' : ''}">${m.label}</button>`
        )
        .join('')}
    </div>
    <div class="field">
      <label>APIキー</label>
      <input type="password" id="s-apikey" value="${escapeHtml(key)}" placeholder="${meta.keyPlaceholder}">
    </div>
    <div class="field">
      <label>使用モデル</label>
      <select id="s-model">
        ${meta.models.map((o) => `<option value="${o.value}" ${o.value === model ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>
    <div class="hint">
      APIキーはこの端末のブラウザ内にのみ保存され、写真解析時に直接プロバイダへ送信されます(サーバーは経由しません)。
      <a href="${meta.keyUrl}" target="_blank" rel="noopener" style="color:var(--accent);">キーを発行する</a><br>
      ${meta.note}
    </div>
  `;
}

function bindProviderCardEvents() {
  const group = document.getElementById('s-provider');
  group.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      // Persist whatever the user typed for the provider they're leaving so it's not lost.
      const leavingProvider = group.querySelector('button.selected').dataset.value;
      cache.apiKeys[leavingProvider] = document.getElementById('s-apikey').value.trim();
      cache.models[leavingProvider] = document.getElementById('s-model').value;

      const newProvider = b.dataset.value;
      document.getElementById('provider-card-body').innerHTML = providerCardHtml(newProvider);
      bindProviderCardEvents();
    });
  });
}

function renderSettings() {
  const p = cache.profile ?? {};
  const t = cache.targets;
  const isWelcome = location.hash.includes('welcome=1');

  app.innerHTML = `
    <div class="header">
      <h1>設定</h1>
      <div class="subtitle">プロフィール・目標・APIキー</div>
    </div>
    <div class="screen">
      ${isWelcome ? `<div class="banner info">セットアップ完了！AI解析を使うにはAPIキーを登録してください(AnthropicまたはGoogle Geminiが選べます)。</div>` : ''}

      <div class="card">
        <div class="card-title">AIプロバイダ・APIキー</div>
        <div id="provider-card-body">${providerCardHtml(cache.provider)}</div>
      </div>

      <div class="card">
        <div class="card-title">体格・目標</div>
        ${profileFormHtml(p)}
        <button class="btn secondary" id="recalc-btn" style="margin-top:4px;">目標を自動計算</button>
      </div>

      <div class="card">
        <div class="card-title">1日の目標値 (手動調整可)</div>
        <div class="field-row">
          <div class="field"><label>カロリー</label><input type="number" id="t-calories" value="${t.calories}"></div>
          <div class="field"><label>タンパク質(g)</label><input type="number" id="t-protein" value="${t.protein}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>脂質(g)</label><input type="number" id="t-fat" value="${t.fat}"></div>
          <div class="field"><label>炭水化物(g)</label><input type="number" id="t-carbs" value="${t.carbs}"></div>
        </div>
      </div>

      <button class="btn" id="save-settings-btn">保存する</button>
    </div>
    ${renderNav('settings')}
  `;
  attachNav();

  const selectGroup = (id) => {
    const group = document.getElementById(id);
    group.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
    });
  };
  selectGroup('f-sex');
  selectGroup('f-activity');
  selectGroup('f-goal');
  bindProviderCardEvents();

  document.getElementById('recalc-btn').addEventListener('click', () => {
    const profile = readProfileForm();
    if (!profile) return;
    const targets = computeTargets(profile);
    document.getElementById('t-calories').value = targets.calories;
    document.getElementById('t-protein').value = targets.protein;
    document.getElementById('t-fat').value = targets.fat;
    document.getElementById('t-carbs').value = targets.carbs;
  });

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const profile = readProfileForm();
    if (!profile) return;
    const targets = {
      calories: Number(document.getElementById('t-calories').value) || DEFAULT_TARGETS.calories,
      protein: Number(document.getElementById('t-protein').value) || DEFAULT_TARGETS.protein,
      fat: Number(document.getElementById('t-fat').value) || DEFAULT_TARGETS.fat,
      carbs: Number(document.getElementById('t-carbs').value) || DEFAULT_TARGETS.carbs,
    };
    const provider = document.querySelector('#s-provider button.selected').dataset.value;
    cache.apiKeys[provider] = document.getElementById('s-apikey').value.trim();
    cache.models[provider] = document.getElementById('s-model').value;

    await db.setSetting('profile', profile);
    await db.setSetting('targets', targets);
    await db.setSetting('provider', provider);
    await db.setSetting('apiKeyAnthropic', cache.apiKeys.anthropic);
    await db.setSetting('apiKeyGemini', cache.apiKeys.gemini);
    await db.setSetting('modelAnthropic', cache.models.anthropic);
    await db.setSetting('modelGemini', cache.models.gemini);
    await db.setSetting('onboarded', true);
    await loadCache();
    history.replaceState(null, '', '#/dashboard');
    render();
  });
}

function readProfileForm() {
  const weightKg = Number(document.getElementById('f-weight').value);
  const heightCm = Number(document.getElementById('f-height').value);
  const age = Number(document.getElementById('f-age').value);
  if (!weightKg || !heightCm || !age) {
    alert('体重・身長・年齢をすべて入力してください');
    return null;
  }
  const sex = document.querySelector('#f-sex button.selected').dataset.value;
  const activity = document.querySelector('#f-activity button.selected').dataset.value;
  const goal = document.querySelector('#f-goal button.selected').dataset.value;
  return { weightKg, heightCm, age, sex, activity, goal };
}

// ---------- router ----------

async function render() {
  await loadCache();
  if (!cache.onboarded) {
    renderOnboarding();
    return;
  }
  const route = currentRoute();
  if (route === 'dashboard') return renderDashboard();
  if (route === 'log') {
    resetLogState();
    return renderLog();
  }
  if (route === 'history') return renderHistory();
  if (route.startsWith('history/')) return renderHistoryDay(route.split('/')[1]);
  if (route.startsWith('settings')) return renderSettings();
  return renderDashboard();
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
