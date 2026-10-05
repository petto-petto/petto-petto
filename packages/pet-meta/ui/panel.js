// 메타 패널 프론트엔드.
//
// 규칙은 한 줄도 없다. Rust가 만들어 준 화면 모델을 DOM으로 옮기기만 한다.
// 예를 들어 히든 업적 마스킹은 이미 `pet-meta`에서 끝나 있으므로, 여기서는
// 내려온 값을 그대로 그린다.
//
// innerHTML을 쓰지 않고 DOM을 조립하는 이유: 모델명 같은 값은 결국 외부 CLI 로그에서
// 온다. 프로토타입에서는 픽스처지만 제품에서는 우리가 통제하지 않는 문자열이므로,
// 처음부터 textContent로만 넣는다.

// preload가 노출한 API. 렌더러는 Node에도 임의 IPC 채널에도 닿지 못한다.
const api = window.petApi;

/* ---------- 작은 DOM 도우미 ---------- */

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
  }
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      node.addEventListener(event, handler);
    }
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

const nf = new Intl.NumberFormat('ko-KR');
const num = (value) => nf.format(value ?? 0);

/**
 * 큰 수를 짧게 쓴다. `만`·`억` 대신 표준 단위(K · M · B)를 쓴다. 화면의 모든 큰 수가 이
 * 함수 하나를 지난다 — 같은 화면에 `5K`와 `5,000`이 섞이지 않게 한다.
 *
 * 토큰 수치는 도구가 보고하는 값이고, 그 도구들이 쓰는 단위가 K · M · B다. 한글 단위로
 * 바꾸면 사용자가 다른 화면에서 본 숫자와 머릿속으로 환산해야 한다.
 *
 * 1,000 미만은 그대로다. 그 이상은 100 미만이면 소수 한 자리(`.0` 생략), 100 이상이면 정수로
 * 400px 폭에서 자리수가 넘치지 않게 한다. 반올림으로 1000 에 닿으면 다음 단위로 올린다
 * (999,949 → `1M`, `1000K`가 아니라).
 */
const COMPACT_UNITS = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
];

function compact(value) {
  const n = Number(value ?? 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const format = (scaled, unit) => {
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
    return `${sign}${text.replace(/\.0$/, '')}${unit}`;
  };
  for (let index = 0; index < COMPACT_UNITS.length; index += 1) {
    const [divisor, unit] = COMPACT_UNITS[index];
    if (abs < divisor) continue;
    const scaled = abs / divisor;
    const rounded = Number(scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1));
    const larger = COMPACT_UNITS[index - 1];
    if (rounded >= 1_000 && larger) return format(abs / larger[0], larger[1]);
    return format(scaled, unit);
  }
  return nf.format(n);
}

/** `Field<T>`를 그린다. 오류면 그 자리에만 오류를 표시한다(INFO-007). */
function fieldValue(field, format = num) {
  if (!field) return el('div', { class: 'value error', text: '—' });
  if (field.error) {
    // 가이드: 색상에만 의존하지 않는다. 아이콘을 함께 준다.
    return el('div', { class: 'value error', text: '⚠ 조회 실패', title: field.error });
  }
  return el('div', { class: 'value', text: format(field.value) });
}

function stat(label, valueNode) {
  return el('div', { class: 'stat' }, [el('div', { class: 'label', text: label }), valueNode]);
}

/**
 * EXP 진행 줄. 레벨 옆에 지금 얼마나 찼는지 보여준다.
 *
 * 최고 레벨이면 성장 도메인이 `required: 0`을 준다. 이때 0으로 나누지 않고 꽉 찬 막대와
 * `MAX`를 보여준다.
 */
function expRow(field) {
  if (field.error) {
    return el('div', { class: 'exp-row' }, [
      el('span', { class: 'exp-label', text: 'EXP' }),
      el('span', { class: 'exp-value error', text: '⚠ 조회 실패' }),
    ]);
  }
  const { current, required } = field.value;
  const atMax = required === 0;
  return el('div', { class: 'exp-row' }, [
    el('span', { class: 'exp-label', text: 'EXP' }),
    bar(atMax ? 1 : current / required),
    el('span', {
      class: 'exp-value',
      text: atMax
        ? 'MAX'
        : `${current.toLocaleString('ko-KR')} / ${required.toLocaleString('ko-KR')}`,
    }),
  ]);
}

function bar(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  return el('div', { class: 'bar' }, [
    el('span', { attrs: { style: `width:${(clamped * 100).toFixed(1)}%` } }),
  ]);
}

/**
 * 화면 공용 그림 — 팔레트와 종류 아이콘(동전 · 깃발 · 잔).
 *
 * 줄마다 달라지지 않으므로 한 번만 받아 둔다. 받기 전에 그리면 색이 없는 그림이 나오므로 모든
 * 렌더가 `iconsReady` 를 기다린다.
 */
let icons = { palette: {}, rewards: {} };
const iconsReady = api.uiIcons().then((loaded) => {
  icons = loaded;
});

/**
 * 토큰을 뜻하는 동전. 토큰 숫자 옆에는 어디서나 이 그림을 둔다 — 업적 보상의 동전과 정보 화면의
 * 숫자가 같은 것임이 그림으로 읽힌다. `large` 는 화면에서 가장 강조되는 값에 쓰는 3배 크기다.
 */
function tokenIcon(large = false) {
  const canvas = badgeCanvas(icons.rewards.token ?? []);
  canvas.setAttribute('class', large ? 'token-icon large' : 'token-icon');
  return canvas;
}

/** 동전과 숫자를 한 덩어리로 묶는다. 줄이 바뀌어도 둘이 떨어지지 않는다. */
function withToken(node, large = false) {
  return el('span', { class: 'with-token' }, [tokenIcon(large), node]);
}

/** 잠긴 배지의 색 농도. 원래 색의 절반을 칸 바탕에 섞는다. */
const LOCKED_BADGE_ALPHA = 0.5;

/**
 * 업적 배지를 그린다. 16×16 픽셀 그림을 캔버스에 1:1 로 찍고, 크기는 CSS 가 정수 배율로 키운다.
 *
 * 달성한 업적은 팔레트 색 그대로다. 잠긴 업적도 **자기 색**으로 그리되 절반만 올려 바탕에 묻히게
 * 한다. 예전에는 잠긴 배지를 나무색으로만 칠했는데, 처음 쓰는 사용자는 전부 잠겨 있어서 목록이
 * 온통 갈색이었다. 달성은 색의 선명함에 더해 금색 띠와 달성 시각으로 구분된다.
 */
function badgeCanvas(rows, unlocked = true) {
  const palette = icons.palette;
  const size = rows.length;
  const canvas = el('canvas', { attrs: { width: size, height: size, 'aria-hidden': 'true' } });
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.imageSmoothingEnabled = false;
  context.globalAlpha = unlocked ? 1 : LOCKED_BADGE_ALPHA;

  rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x += 1) {
      const pixel = line[x];
      if (pixel === '.') continue;
      context.fillStyle = palette[pixel];
      context.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

/* ---------- 화면 상태 ---------- */

const SUBTABS = {
  // 정보 화면 단순화: 실적 탭은 없앴다. 핵심은 요약·사용량에, 나머지는 `자세히` 안에 있다.
  info: [
    ['summary', '요약'],
    ['usage', '사용량'],
  ],
  settings: [
    ['collect', '수집'],
    ['display', '화면'],
    ['notifications', '알림'],
    ['misc', '기타'],
  ],
  achievements: [],
  demo: [],
};

// 기획서 4.2: 정보의 기본은 `요약`, 설정의 기본은 `수집`.
const DEFAULT_SUBTAB = { info: 'summary', settings: 'collect' };

const ui = {
  screen: 'info',
  subtab: 'summary',
  period: 'all',
  modelsExpanded: false,
  achievementFilter: 'all',
  /** `갱신` 실행 중. 다시 그려도 버튼이 비활성으로 남도록 화면 밖에 둔다. */
  refreshing: false,
  /** 정보 탭의 `자세히` 펼침. 저장하지 않고, 서브탭·화면이 바뀌면 접는다. */
  expanded: false,
};

const content = document.getElementById('content');
const subtabBar = document.getElementById('subtabs');

/* ---------- 라우팅 ---------- */

function selectScreen(screen, { resetSubtab = true } = {}) {
  ui.screen = screen;
  // 패널을 다시 열거나 화면을 바꾸면 항상 접힌 상태로 시작한다.
  ui.expanded = false;
  if (resetSubtab) ui.subtab = DEFAULT_SUBTAB[screen] ?? '';
  // 탭(정보·업적)과 하단 설정 아이콘이 같은 선택 상태를 공유한다.
  for (const tab of document.querySelectorAll('[data-screen]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.screen === screen));
  }
  applyChrome(screen);
  renderSubtabs();
  render();
}

/**
 * 화면에 맞춰 창 테두리(탭·제목·설정 입구)를 바꾼다.
 *
 * 설정은 전용 화면이다. 들어가면 다른 화면의 탭을 감추고 설정만 남긴다. 대신
 * 나가는 길(`←`)을 반드시 함께 띄운다 — 이게 없으면 설정에 갇힌다.
 */
function applyChrome(screen) {
  const settingsMode = screen === 'settings';
  for (const tab of document.querySelectorAll('.screen-tab')) {
    tab.hidden = settingsMode;
  }
  document.getElementById('settings-button').hidden = settingsMode;
  document.getElementById('back-button').hidden = !settingsMode;
  document.getElementById('mode-title').hidden = !settingsMode;
}

function renderSubtabs() {
  subtabBar.replaceChildren();
  for (const [key, label] of SUBTABS[ui.screen] ?? []) {
    subtabBar.appendChild(
      el('button', {
        class: 'subtab',
        text: label,
        attrs: { 'aria-selected': String(ui.subtab === key) },
        on: {
          click: () => {
            ui.subtab = key;
            ui.expanded = false;
            renderSubtabs();
            render();
          },
        },
      }),
    );
  }
  // 정보 화면에서는 서브탭 줄 오른쪽 끝에 `갱신`을 둔다. 요약·사용량 어디서나 같은 자리다.
  if (ui.screen === 'info') {
    subtabBar.appendChild(el('span', { class: 'subtab-spacer' }));
    subtabBar.appendChild(refreshButton());
  }
}

/**
 * 렌더 세대. 렌더는 IPC 를 기다리므로 늦게 시작한 렌더가 먼저 끝날 수 있다 — 요약을 누르고
 * 곧바로 사용량을 누르면 느린 요약이 나중에 도착해 사용량 화면을 덮는다. 각 렌더는 시작할
 * 때의 세대를 들고 있다가, 그사이 새 렌더가 시작됐으면 그리지 않는다.
 */
let renderGeneration = 0;

function commit(generation, ...nodes) {
  if (generation !== renderGeneration) return;
  content.replaceChildren(...nodes);
}

/** 가장 최근에 시작한 렌더. 클릭 뒤 화면이 다 그려지기를 기다려야 하는 쪽(self-test)이 쓴다. */
let renderDone = Promise.resolve();

function render() {
  renderGeneration += 1;
  renderDone = renderNow();
  return renderDone;
}

async function renderNow() {
  content.classList.remove('no-scroll');
  try {
    await iconsReady;
    if (ui.screen === 'info') {
      if (ui.subtab === 'summary') return await renderSummary();
      return await renderUsage();
    }
    if (ui.screen === 'settings') return await renderSettings();
    if (ui.screen === 'achievements') return await renderAchievements();
    return renderDemo();
  } catch (error) {
    content.replaceChildren(
      el('div', { class: 'error-block', text: `화면을 그리지 못했습니다: ${error}` }),
    );
  }
}

/* ---------- 정보 · 공통 ---------- */

/**
 * `자세히` / `접기` 버튼. 정보의 두 탭은 핵심만 먼저 보이고 나머지는 여기로 펼친다.
 *
 * 펼침은 저장하지 않는다 — 서브탭을 바꾸거나 패널을 다시 열면 접힌다(정보 화면 단순화 사양).
 */
function expandButton() {
  return el('button', {
    class: 'expand-button',
    text: ui.expanded ? '접기 ▴' : '자세히 ▾',
    attrs: { 'aria-expanded': String(ui.expanded) },
    on: {
      click: () => {
        ui.expanded = !ui.expanded;
        render();
      },
    },
  });
}

/**
 * 서브탭 줄 오른쪽 끝의 `갱신` 버튼. 요약·사용량 어디서나 같은 자리다.
 *
 * 1분 주기와 같은 채널(`collect:now`)을 부르므로 규칙이 따로 없다. 실행 중에는 비활성이고,
 * 연타해도 수집기가 합류시켜 한 번만 돈다.
 */
function refreshButton() {
  const button = el('button', {
    class: 'tiny-button refresh-button',
    text: ui.refreshing ? '갱신 중…' : '갱신',
    attrs: { 'aria-label': '사용량 지금 갱신' },
    on: {
      click: async () => {
        if (ui.refreshing) return;
        ui.refreshing = true;
        renderSubtabs();
        try {
          const report = await api.aggregateNow();
          // 실패를 성공처럼 보이지 않게 한다. 기록 없음은 실패가 아니다(보고서가 거른다).
          if (report?.failures?.length) flash(report.failures.join(' · '), true);
          else flash(report?.bubble ?? '갱신했습니다');
        } catch (error) {
          flash(String(error), true);
        } finally {
          ui.refreshing = false;
          renderSubtabs();
          render();
        }
      },
    },
  });
  button.disabled = ui.refreshing;
  return button;
}

/* ---------- 정보 · 요약 ---------- */

async function renderSummary() {
  const generation = renderGeneration;
  const data = await api.infoSummary();

  /*
   * 실제 오버레이 펫의 초상화를 쓴다. 주소는 앱이 준다 — 에셋 배치는 패널이 모른다.
   *
   * 크기를 지정하지 않는 이유: 원본 그대로 그려야 픽셀이 고르다. 32px과 48px 두 종류가
   * 있어 어느 쪽이든 상자 안에 그대로 놓는다.
   */
  const portrait = await api.petPortrait().catch(() => undefined);
  const petThumb = el('div', { class: 'pet-thumb' }, [
    portrait
      ? el('img', { attrs: { src: portrait, alt: '' } })
      : el('span', {
          text: data.profile.activePet.error ? '❓' : '🐾',
          attrs: { style: 'font-size:16px' },
        }),
  ]);

  /*
   * 활성 펫은 세 상태다 — 펫이 있음 · 아직 고른 펫이 없음 · 읽지 못함.
   *
   * `null` 과 오류를 섞지 않는다. 새 설치에는 보유 펫이 없어 “없음”이 흔한 정상 상태인데,
   * 그걸 “불러오지 못했어요”로 보여주면 사용자는 무언가 고장 났다고 읽는다(기획서 INFO-001).
   */
  const activePet = data.profile.activePet;
  const headline = activePet.error
    ? '펫 정보를 불러오지 못했어요'
    : activePet.value === null
      ? '아직 함께하는 펫이 없어요'
      : `${activePet.value.name} · Lv.${activePet.value.level}`;

  // 칭호는 칩이 아니라 이름 옆 작은 글자다. 없으면 아무것도 두지 않는다.
  const profile = el('div', { class: 'card' }, [
    el('div', { class: 'profile' }, [
      petThumb,
      el('div', { class: 'profile-body' }, [
        el('div', { class: 'pet-headline' }, [
          el('span', { text: headline }),
          data.profile.equippedTitle
            ? el('span', { class: 'pet-title', text: data.profile.equippedTitle })
            : null,
        ]),
        // 펫이 없으면 경험치를 물어볼 대상도 없다. 빈 막대를 그리지 않는다.
        ...(activePet.value ? [expRow({ value: activePet.value.experience })] : []),
      ]),
    ]),
  ]);

  /*
   * 화면에서 가장 강조되는 값. 사용자가 지금 쓸 수 있는 재화다.
   *
   * K·M·B 로 줄여 크기를 한눈에 보이게 하고, 정확한 값은 마우스를 올리면 보인다.
   */
  const hero = el('div', { class: 'card hero' }, [
    el('div', { class: 'hero-label', text: '사용 가능 토큰' }),
    el('div', { class: 'hero-figure' }, [
      data.availableTokens.error
        ? el('span', { class: 'hero-value error', text: '⚠ 조회 실패' })
        : withToken(
            el('span', {
              class: 'hero-value',
              text: compact(data.availableTokens.value),
              title: `${num(data.availableTokens.value)} 토큰`,
            }),
            true,
          ),
      data.todayEarnedTokens.error
        ? el('span', { class: 'hero-sub', text: '오늘 조회 실패' })
        : el('span', { class: 'hero-sub with-token' }, [
            el('span', { text: '오늘' }),
            tokenIcon(),
            el('span', { text: `+${num(data.todayEarnedTokens.value)}` }),
          ]),
    ]),
    // 기획서 5.4: 기록이 없는 설치는 오류가 아니라 빈 상태다. 0 만 보이면 고장처럼 읽힌다.
    data.hasNoRecords
      ? el('div', {
          class: 'card-note',
          text: '아직 기록이 없습니다. 앱을 켜 둔 동안 쓴 토큰만 쌓여요',
        })
      : null,
  ]);

  if (!ui.expanded) {
    commit(generation, profile, hero, expandButton());
    return;
  }

  const records = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [el('span', { text: '함께한 기록' })]),
    el('div', { class: 'stat-grid record-grid' }, [
      // 사용 가능 토큰과 같은 원장의 값이다. 지금까지 쌓은 양이고, 써도 줄지 않는다.
      stat(
        '누적 토큰',
        data.totalEarnedTokens.error
          ? fieldValue(data.totalEarnedTokens)
          : el('div', { class: 'value with-token' }, [
              tokenIcon(),
              el('span', { text: compact(data.totalEarnedTokens.value) }),
            ]),
      ),
      stat('함께한 시간', el('div', { class: 'value small', text: data.togetherLabel })),
      stat(
        '뽑은 횟수',
        // 뽑기가 아직 횟수를 저장하지 않는다. 0 은 실제 값이라 쓰지 않고 모른다고 그린다.
        !data.drawCount.error && data.drawCount.value === null
          ? el('div', { class: 'value', text: '—', title: '뽑기 횟수는 아직 기록되지 않아요' })
          : fieldValue(data.drawCount),
      ),
      stat('보유 펫', fieldValue(data.ownedPets)),
      stat(
        '도감',
        // 전체 칸 수도 펫 조회에서 온다. 둘 중 하나라도 못 읽으면 `3/undefined` 를 그리지 않는다.
        data.dexOwned.error || data.dexTotal.error
          ? el('div', { class: 'value error', text: '⚠ 조회 실패' })
          : el('div', {
              class: 'value small',
              text: `${data.dexOwned.value}/${data.dexTotal.value}`,
            }),
      ),
      stat(
        '업적',
        el('div', {
          class: 'value small',
          text: `${data.achievementsUnlocked}/${data.achievementsTotal}`,
        }),
      ),
    ]),
  ]);

  commit(generation, profile, hero, records, expandButton());
}

/* ---------- 정보 · 사용량 ---------- */

/** 기간 필터. 순서는 전체가 먼저다 — 처음 열면 전체를 본다. */
const PERIODS = [
  ['all', '전체'],
  ['today', '오늘'],
  ['week', '주'],
  ['month', '달'],
];

async function renderUsage() {
  const generation = renderGeneration;
  const data = await api.infoUsage(ui.period);

  const filters = el(
    'div',
    { class: 'segmented period-filter' },
    PERIODS.map(([key, label]) =>
      el('button', {
        text: label,
        attrs: { 'aria-selected': String(ui.period === key) },
        on: {
          click: () => {
            ui.period = key;
            ui.modelsExpanded = false;
            render();
          },
        },
      }),
    ),
  );

  // 비율(%)은 숫자로 쓰지 않는다. 막대가 보여준다.
  const usageCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-label', text: '쌓인 토큰' }),
    el('div', { class: 'usage-headline' }, [
      withToken(
        el('span', {
          class: 'usage-total',
          text: compact(data.periodTokens),
          title: `${num(data.periodTokens)} 토큰`,
        }),
        true,
      ),
      filters,
    ]),
    ...(data.tools.length
      ? data.tools.map((row) =>
          el('div', { class: 'row' }, [
            el('span', { class: 'badge', text: row.providerLabel }),
            el('span', { class: 'name' }, [bar(row.sharePercent / 100)]),
            row.paused ? el('span', { class: 'status paused', text: row.statusLabel }) : null,
            el('span', { class: 'num', text: compact(row.tokens) }),
          ]),
        )
      : [el('div', { class: 'empty', text: '이 기간에 기록이 없습니다' })]),
    el('div', {
      class: 'usage-refreshed mono-small',
      text: `마지막 갱신 ${data.lastRefreshedLabel}`,
    }),
  ]);

  if (!ui.expanded) {
    commit(generation, usageCard, expandButton());
    return;
  }

  const shown = ui.modelsExpanded ? data.models : data.models.slice(0, 5);
  const modelsCard = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '모델별' }),
      el('span', { text: `${data.modelCount}개` }),
    ]),
    ...(shown.length
      ? shown.map((row) =>
          el('div', { class: 'row model-row' }, [
            el('span', { class: 'badge', text: row.providerLabel }),
            el('span', { class: 'name', text: row.rawModel, title: row.rawModel }),
            el('span', { class: 'num', text: compact(row.tokens) }),
          ]),
        )
      : [el('div', { class: 'empty', text: '이 기간에 기록이 없습니다' })]),
    data.modelCount > 5
      ? el('button', {
          class: 'tiny-button',
          text: ui.modelsExpanded ? '접기' : `전체 ${data.modelCount}개 모델 보기`,
          attrs: { style: 'margin-top:6px' },
          on: {
            click: () => {
              ui.modelsExpanded = !ui.modelsExpanded;
              render();
            },
          },
        })
      : null,
  ]);

  // 기획서 5.2: 제목 옆에 `최근 12주`를 명시해 기간 필터와 혼동하지 않게 한다. 범례는 두지
  // 않는다 — 칸에 마우스를 올리면 날짜와 토큰이 보인다(INFO-004).
  const grassCard = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [el('span', { text: '최근 12주' })]),
    el(
      'div',
      { class: 'grass' },
      data.grass.map((week) =>
        el(
          'div',
          { class: 'grass-week' },
          week.cells.map((cell) =>
            el('div', {
              class: `grass-cell l${cell.level}${cell.future ? ' future' : ''}`,
              title: cell.future ? cell.date : `${cell.date} · ${num(cell.tokens)} 토큰`,
              // 범례가 없으므로 키보드로도 칸마다 날짜와 토큰에 닿아야 한다(INFO-004).
              attrs: cell.future
                ? {}
                : {
                    tabindex: '0',
                    role: 'img',
                    'aria-label': `${cell.date} ${num(cell.tokens)} 토큰`,
                  },
            }),
          ),
        ),
      ),
    ),
  ]);

  commit(generation, usageCard, modelsCard, grassCard, expandButton());
}

/* ---------- 설정 ---------- */

function switchButton(checked, onToggle) {
  return el('button', {
    class: 'switch',
    attrs: { 'aria-checked': String(checked), role: 'switch' },
    on: { click: () => onToggle(!checked) },
  });
}

async function renderSettings() {
  const generation = renderGeneration;
  const data = await api.settingsView();

  if (ui.subtab === 'collect') {
    const notice = data.openCollectTab
      ? el('div', {
          class: 'notice warn',
          text: '세 수집 소스를 모두 찾지 못했어요. 기본 위치를 확인해 주세요.',
        })
      : null;

    const cards = data.collect.map((card) =>
      el('div', { class: 'card collect-card' }, [
        el('div', { class: 'head' }, [
          el('span', { class: 'badge', text: '◆' }),
          el('span', { class: 'name', text: card.providerLabel }),
          el('span', { class: `status ${card.status}`, text: card.statusLabel }),
        ]),
        el('div', { class: 'path', text: card.defaultLocation }),
        card.lastError ? el('div', { class: 'error-text', text: card.lastError }) : null,
        el('div', { class: 'foot' }, [
          el('span', { text: `마지막 정상 ${card.lastSuccessLabel}` }),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'tiny-button',
            text: '재스캔',
            attrs: { disabled: card.enabled ? null : 'disabled' },
            on: {
              click: async () => {
                const report = await api.rescan(card.provider);
                flash(report.sourceNotes[0] ?? '재스캔했습니다');
                render();
              },
            },
          }),
          switchButton(card.enabled, async (next) => {
            await api.toggleSource(card.provider, next);
            render();
          }),
        ]),
      ]),
    );

    commit(
      generation,
      ...[notice, ...cards].filter(Boolean),
      el('div', { class: 'card' }, [
        el('div', {
          class: 'mono-small',
          text: '사용자 지정 경로는 제공하지 않습니다 (기획서 SET-004)',
        }),
      ]),
    );
    return;
  }

  if (ui.subtab === 'display') {
    commit(
      generation,
      el('div', { class: 'card' }, [
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'text' }, [
            el('div', { text: '오버레이 표시' }),
            el('div', { class: 'note', text: '끄면 트레이만 유지됩니다' }),
          ]),
          switchButton(data.display.overlayVisible, async (next) => {
            await api.setDisplaySetting('overlay_visible', next);
            render();
          }),
        ]),
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'text' }, [el('div', { text: '펫 크기' })]),
          el(
            'div',
            { class: 'segmented' },
            [
              ['small', '작게'],
              ['normal', '보통'],
              ['large', '크게'],
            ].map(([key, label]) =>
              el('button', {
                text: label,
                attrs: { 'aria-selected': String(data.display.petSize === key) },
                on: {
                  click: async () => {
                    await api.setDisplaySetting('pet_size', key);
                    render();
                  },
                },
              }),
            ),
          ),
        ]),
        el('div', { class: 'setting-row' }, [
          el('div', { class: 'text' }, [
            el('div', { text: '부팅 시 자동 실행' }),
            data.display.autostartNote
              ? el('div', { class: 'note', text: data.display.autostartNote })
              : null,
          ]),
          switchButton(data.display.autostart, async (next) => {
            await api.setDisplaySetting('autostart', next);
            render();
          }),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('div', {
          class: 'mono-small',
          text: `패널 크기 ${data.display.panelWidth} × ${data.display.panelHeight} — 펫 크기와 무관하게 고정 (SET-005)`,
        }),
        el('div', {
          class: 'mono-small',
          text: '항상 맨 위는 설정 없이 고정. 클릭 통과·집중 모드는 제공하지 않습니다.',
        }),
      ]),
    );
    return;
  }

  if (ui.subtab === 'notifications') {
    const rows = [
      ['levelup', '레벨업', data.notifications.levelup, '해당 펫 화면 열기'],
      ['achievement', '업적 달성', data.notifications.achievement, '업적 화면 열기'],
      ['gacha_ready', '뽑기 가능', data.notifications.gachaReady, '뽑기 화면 열기'],
    ];
    commit(
      generation,
      el(
        'div',
        { class: 'card' },
        rows.map(([key, label, value, note]) =>
          el('div', { class: 'setting-row' }, [
            el('div', { class: 'text' }, [
              el('div', { text: label }),
              el('div', { class: 'note', text: `클릭하면 ${note}` }),
            ]),
            switchButton(value, async (next) => {
              await api.setNotification(key, next);
              render();
            }),
          ]),
        ),
      ),
      el('div', { class: 'card' }, [
        el('div', {
          class: 'mono-small',
          text: '알림은 펫 말풍선으로만 표시합니다. 운영체제 알림 센터는 쓰지 않습니다.',
        }),
      ]),
    );
    return;
  }

  // 기타
  commit(
    generation,
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [el('span', { text: '로컬 데이터' })]),
      el('div', { class: 'path', text: data.misc.dataLocation }),
      el('div', { class: 'foot', attrs: { style: 'margin-top:6px' } }, [
        el('button', {
          class: 'tiny-button',
          text: '위치 열기',
          on: { click: () => api.revealDataLocation().catch((e) => flash(String(e), true)) },
        }),
      ]),
      el('div', {
        class: 'mono-small',
        attrs: { style: 'margin-top:6px' },
        text: '백업·복원·초기화는 제공하지 않습니다 (SET-009)',
      }),
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [el('span', { text: '개발자에게 커피 한 잔' })]),
      el(
        'div',
        { class: 'link-list' },
        data.misc.sponsors.map((button) =>
          el('button', {
            class: 'tiny-button',
            text: button.enabled ? button.label : `${button.label} · ${button.note}`,
            attrs: { disabled: button.enabled ? null : 'disabled' },
            on: {
              click: () => api.openExternal(button.url).catch((e) => flash(String(e), true)),
            },
          }),
        ),
      ),
      el('div', {
        class: 'mono-small',
        attrs: { style: 'margin-top:6px' },
        text: '후원은 게임 내 토큰·칭호·트로피와 연결되지 않습니다',
      }),
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [
        el('span', { text: '앱 정보' }),
        el('span', { text: `v${data.misc.version}` }),
      ]),
      ...data.misc.licenses.map((line) => el('div', { class: 'mono-small', text: line })),
      ...data.misc.assetCredits.map((line) => el('div', { class: 'mono-small', text: line })),
    ]),
  );
}

/* ---------- 업적 ---------- */

async function renderAchievements() {
  const generation = renderGeneration;
  const data = await api.achievementsView(ui.achievementFilter);

  const filters = el(
    'div',
    { class: 'filter-bar' },
    [
      ['all', '전체'],
      ['collection', '수집'],
      ['growth', '성장'],
      ['battle', '전투'],
      ['usage', '사용량'],
      ['hidden', '히든'],
    ].map(([key, label]) =>
      el('button', {
        class: 'subtab',
        text: label,
        attrs: { 'aria-selected': String(ui.achievementFilter === key) },
        on: {
          click: () => {
            ui.achievementFilter = key;
            render();
          },
        },
      }),
    ),
  );

  const header = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '완료율' }),
      el('span', { text: `${data.unlocked} / ${data.total} · ${data.completionPercent}%` }),
    ]),
    bar(data.total ? data.unlocked / data.total : 0),
    // 다른 필터 탭에 남은 보상도 놓치지 않게 전체 기준으로 센다.
    data.claimableCount > 0
      ? el('div', { class: 'claim-note' }, [
          // 금색 칩 — 지금 받을 수 있는 보상이 있다는 표시다.
          el('span', { class: 'chip', text: `받을 보상 ${data.claimableCount}개` }),
        ])
      : null,
  ]);

  const titleCard = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [el('span', { text: '칭호' })]),
    data.titles.length
      ? el('div', { class: 'link-list' }, [
          ...data.titles.map((title) =>
            el('button', {
              class: 'tiny-button',
              text: title.equipped ? `★ ${title.name}` : title.name,
              on: {
                click: async () => {
                  await api.equipTitle(title.equipped ? null : title.name);
                  render();
                },
              },
            }),
          ),
          data.equippedTitle
            ? el('button', {
                class: 'tiny-button',
                text: '해제',
                on: {
                  click: async () => {
                    await api.equipTitle(null);
                    render();
                  },
                },
              })
            : null,
        ])
      : el('div', { class: 'empty', text: '아직 획득한 칭호가 없습니다' }),
  ]);

  const list = el(
    'div',
    { class: 'card' },
    data.rows.map((row) =>
      el(
        'div',
        {
          class: `ach${row.unlocked ? ' unlocked' : ''}${row.masked ? ' masked' : ''}`,
        },
        [
          el(
            'div',
            {
              class: 'medal',
              // 그림은 장식이다. 상태는 색에만 기대지 않도록 글자로도 준다.
              title: row.unlocked ? '달성' : row.masked ? '히든' : '잠김',
            },
            [badgeCanvas(row.badge, row.unlocked)],
          ),
          el('div', { class: 'body' }, [
            el('div', { class: 'title-line' }, [
              el('span', { class: 'name', text: row.name }),
              // 분류는 상자에 넣지 않는다. 보상과 같은 모양이면 무엇이 무엇인지 섞여 보인다.
              el('span', { class: 'category', text: row.categoryLabel }),
            ]),
            el('div', { class: 'cond', text: row.condition }),
            // 조건 바로 아래에 진행률을 둔다. "무엇을 얼마나 했나"가 한 덩어리로 읽힌다.
            row.masked
              ? null
              : row.unlockedAtLabel
                ? // 달성한 업적은 막대 대신 언제 달성했는지를 적는다. 꽉 찬 막대는 알려 주는 것이 없다.
                  el('div', {
                    class: 'achieved',
                    text: `✓ ${row.progressLabel} ${row.unlockedAtLabel}`,
                  })
                : el('div', { class: 'progress-line' }, [
                    bar(row.target ? row.progress / row.target : 0),
                    el('span', { class: 'num', text: row.progressLabel }),
                  ]),
            row.rewardError
              ? el('div', { class: 'pending', text: `⚠ 받지 못했어요 — ${row.rewardError}` })
              : null,
          ]),
          // 보상은 줄의 오른쪽 위다. 달성하면 그 아래에서 직접 받는다.
          el('div', { class: 'reward-col', attrs: { 'aria-label': '보상' } }, [
            ...row.rewards.map((reward) => rewardItem(reward)),
            rewardAction(row),
          ]),
        ],
      ),
    ),
  );

  commit(generation, filters, header, titleCard, list);
}

/**
 * 보상 하나. 종류마다 모양이 다르다 — 토큰은 동전과 굵은 숫자, 칭호는 깃발과 리본 띠, 트로피는 잔과
 * 글자.
 *
 * 전부 같은 네모 칩이던 때에는 무엇이 토큰이고 무엇이 칭호인지 글자를 읽어야 알았다. 아이콘이
 * 종류를 말해 주므로 글자에는 값만 둔다. 뜻이 온전한 문구는 `title` 과 `aria-label` 에 있다.
 */
function rewardItem(reward) {
  const icon = icons.rewards[reward.kind];
  return el(
    'div',
    {
      class: `reward ${reward.kind}`,
      title: reward.description,
      attrs: { 'aria-label': reward.description },
    },
    [icon ? badgeCanvas(icon) : null, el('span', { class: 'text', text: reward.label })],
  );
}

/**
 * 업적 줄의 보상 아래. 달성했으면 `보상 받기` 버튼, 받았으면 받았다는 표시다.
 *
 * 버튼은 누르는 동안 잠근다. 지급은 멱등이라 두 번 눌러도 한 번만 들어오지만, 응답을 기다리는
 * 사이에 같은 요청을 또 보낼 이유가 없다.
 */
function rewardAction(row) {
  if (row.rewardState === 'claimed') {
    return el('span', { class: 'reward-done', text: '✓ 받음' });
  }
  if (row.rewardState !== 'claimable') return null;

  const button = el('button', {
    class: 'tiny-button claim-button',
    text: row.rewardError ? '다시 받기' : '보상 받기',
    attrs: { 'aria-label': `${row.name} 보상 받기` },
    on: {
      click: async () => {
        button.disabled = true;
        try {
          const outcome = await api.claimAchievement(row.id);
          if (outcome.claimed) flash(`${row.name} 보상을 받았어요`);
          else flash(outcome.error ?? '보상을 받지 못했어요', true);
        } catch (error) {
          flash(String(error?.message ?? error), true);
        }
        render();
      },
    },
  });
  return button;
}

/* ---------- 시연 (프로토타입 전용) ---------- */

function demoButton(label, call) {
  return el('button', {
    class: 'tiny-button',
    text: label,
    on: {
      click: async () => {
        try {
          const report = await call();
          if (report?.bubble) flash(report.bubble);
          else if (report?.sourceNotes?.length) flash(report.sourceNotes.join(' · '));
          else flash('처리했습니다');
        } catch (error) {
          flash(String(error), true);
        }
      },
    },
  });
}

function renderDemo() {
  content.replaceChildren(
    el('div', { class: 'notice warn', text: '프로토타입 시연용 화면입니다. 제품에는 없습니다.' }),
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [el('span', { text: '다른 도메인 이벤트' })]),
      el('div', {
        class: 'mono-small',
        // 펫 업적은 이제 공통 펫 DB 를 직접 읽어 열린다. 손으로 발행할 수 있는 건 아직 테이블이
        // 없는 합성과 전투뿐이다.
        text: '합성 · 전투는 아직 테이블이 없어 손으로 발행합니다. 펫 업적은 펫 DB 로 열립니다',
      }),
      el('div', { class: 'link-list', attrs: { style: 'margin-top:6px' } }, [
        demoButton('커먼2→에픽 합성', () => api.demoEvent('fusion_miracle')),
        demoButton('전투 승리', () => api.demoEvent('battle_win')),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [el('span', { text: '수집' })]),
      el('div', { class: 'link-list' }, [
        demoButton('Claude Code 사용', () => api.demoUsage('claude_code')),
        demoButton('Codex 사용', () => api.demoUsage('codex')),
        demoButton('Gemini 사용', () => api.demoUsage('gemini_cli')),
        demoButton('지금 집계', () => api.aggregateNow()),
      ]),
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'section-title' }, [el('span', { text: '오류 주입' })]),
      el('div', { class: 'mono-small', text: '기획서 11.1의 오류 동작을 화면에서 확인합니다' }),
      el('div', { class: 'link-list', attrs: { style: 'margin-top:6px' } }, [
        demoButton('Codex 수집 실패', () => api.demoBreakSource('codex')),
        demoButton('다음 보상 지급 실패', () => api.demoFailNextReward()),
      ]),
    ]),
  );
}

/* ---------- 짧은 알림 ---------- */

let flashTimer = null;
function flash(message, isError = false) {
  const existing = document.getElementById('flash');
  if (existing) existing.remove();
  const node = el('div', {
    class: `notice${isError ? ' warn' : ''}`,
    text: message,
    attrs: { id: 'flash', style: 'position:absolute;left:8px;right:8px;bottom:8px;z-index:9' },
  });
  document.body.appendChild(node);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => node.remove(), 2600);
}

/* ---------- 배선 ---------- */

/*
 * 창 옮기기는 CSS가 한다.
 *
 * 창 테두리를 껐기 때문에 OS가 옮겨 주지 않는데, Electron은 `-webkit-app-region: drag`가
 * 붙은 영역을 타이틀 바처럼 다룬다. 헤더에 그 속성을 주고 버튼에는 `no-drag`를 줘서
 * 버튼 클릭이 드래그로 먹히지 않게 한다(app.css 참고). JS가 관여할 일이 없다.
 */

for (const tab of document.querySelectorAll('[data-screen]')) {
  tab.addEventListener('click', () => selectScreen(tab.dataset.screen));
}
document.getElementById('close-button').addEventListener('click', () => api.closePanel());
document.getElementById('back-button').addEventListener('click', () => selectScreen('info'));

document.getElementById('demo-button').addEventListener('click', () => selectScreen('demo'));

// 펫 메뉴나 트레이에서 패널을 열면 기본 서브탭으로 진입한다(기획서 4.2).
api.on('panel:show', (screen) => selectScreen(screen));
// 1분 주기 집계가 끝나면 현재 화면을 새로 그린다.
api.on('usage:aggregated', () => render());

(async () => {
  const screen = await api.currentPanelScreen();
  selectScreen(screen);
})();

// 창이 실제로 그려졌는지 확인하기 위한 보고. 프로토타입 검증용이다.
window.addEventListener('load', () => {
  setTimeout(async () => {
    api.debugLog(
      `panel 준비 완료 — 본문 높이 ${Math.round(document.body.getBoundingClientRect().height)}px, ` +
        `노드 ${document.querySelectorAll('*').length}개`,
    );
    if (await api.selftestEnabled()) await runSelftest();
  }, 400);
});

/**
 * 정보 화면 단순화 사양의 수용 기준을 클릭 경로로 확인한다 — 탭 둘, 접힘으로 시작, `자세히`로
 * 펼치고 `접기`로 돌아옴, 서브탭을 바꾸면 접힘, 필터 순서와 기본값, 비율 숫자 없음.
 */
async function selftestInfoLayout() {
  const report = (ok, pass, fail) =>
    api.debugLog(ok ? `[SELFTEST] 정보 ${pass}` : `[SELFTEST] 정보 실패 — ${fail}`);
  // 고정 시간만큼 기다리지 않는다. 클릭이 시작한 렌더가 끝나기를 기다린다.
  const clickExpand = async () => {
    content.querySelector('.expand-button')?.click();
    await renderDone;
  };
  const subtabButton = (label) =>
    [...subtabBar.querySelectorAll('.subtab')].find((button) => button.textContent === label);

  selectScreen('info');
  await renderDone;
  const labels = [...subtabBar.querySelectorAll('.subtab')].map((button) => button.textContent);
  await report(
    labels.join(',') === '요약,사용량',
    `서브탭            ${labels.join(' · ')}`,
    `서브탭이 ${labels.join(',')}`,
  );

  // 요약: 접힘으로 시작하고 스크롤이 없다.
  const noScroll = content.scrollHeight <= content.clientHeight;
  const collapsedSummary = !content.querySelector('.record-grid') && !ui.expanded;
  await report(
    collapsedSummary && noScroll,
    '요약 접힘        함께한 기록 숨김 · 스크롤 없음',
    `요약 접힘 ${collapsedSummary}, 스크롤 없음 ${noScroll}`,
  );

  await clickExpand();
  const stats = [...content.querySelectorAll('.record-grid .stat .label')].map(
    (node) => node.textContent,
  );
  await report(
    stats.join(',') === '누적 토큰,함께한 시간,뽑은 횟수,보유 펫,도감,업적',
    `요약 펼침        함께한 기록 ${stats.length}칸`,
    `요약 펼침 칸 ${stats.join(',')}`,
  );

  await clickExpand();
  await report(
    !content.querySelector('.record-grid'),
    '요약 접기        다시 접힘',
    '접기를 눌러도 펼친 채다',
  );

  // 펼친 채 사용량으로 옮기면 접힌 상태여야 한다.
  await clickExpand();
  subtabButton('사용량')?.click();
  await renderDone;
  const filters = [...content.querySelectorAll('.period-filter button')].map(
    (button) => button.textContent,
  );
  const selected = content.querySelector('.period-filter [aria-selected="true"]')?.textContent;
  const usageCollapsed = !content.querySelector('.model-row') && !content.querySelector('.grass');
  await report(
    usageCollapsed && filters.join(',') === '전체,오늘,주,달' && selected === '전체',
    `사용량 접힘      필터 ${filters.join(' · ')} (기본 ${selected})`,
    `사용량 접힘 ${usageCollapsed}, 필터 ${filters.join(',')}, 선택 ${selected}`,
  );

  await clickExpand();
  const hasGrass = Boolean(content.querySelector('.grass'));
  const percent = [...content.querySelectorAll('.row')].some((row) =>
    row.textContent.includes('%'),
  );
  await report(
    hasGrass && !percent,
    '사용량 펼침      모델별 · 최근 12주 · 비율 숫자 없음',
    `잔디 ${hasGrass}, % 표시 ${percent}`,
  );
  ui.expanded = false;

  // 숫자 축약 규칙. 화면의 모든 큰 수가 지나는 함수라 실제 런타임에서 확인한다.
  const cases = [
    [999, '999'],
    [1_000, '1K'],
    [1_250, '1.3K'],
    [12_480, '12.5K'],
    [123_456, '123K'],
    [999_949, '1M'],
    [1_250_000, '1.3M'],
    [3_400_000_000, '3.4B'],
    [-1_500, '-1.5K'],
  ];
  const wrong = cases.filter(([value, expected]) => compact(value) !== expected);
  await report(
    wrong.length === 0,
    `숫자 축약        ${cases.length}건 (예: 12,480 → ${compact(12_480)})`,
    `숫자 축약 ${wrong.map(([value, expected]) => `${value}→${compact(value)}≠${expected}`).join(', ')}`,
  );
}

/**
 * 사용량 화면의 `갱신` 버튼을 사용자가 누르는 것과 같은 경로(`click`)로 눌러 본다.
 *
 * 누른 직후 비활성 `갱신 중…`이 되고, 집계가 끝나면 다시 `갱신`으로 돌아오며, 켜진 소스가 한
 * 번이라도 성공했다면 마지막 갱신 시각이 채워져야 한다.
 */
async function selftestRefreshButton() {
  const find = () => subtabBar.querySelector('button[aria-label="사용량 지금 갱신"]');
  const waitFor = async (check) => {
    // `갱신 중…`은 집계 시간(수십 ms)만 보이므로 짧은 간격으로 본다. 최대 10초.
    for (let tries = 0; tries < 1000; tries += 1) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  };

  ui.screen = 'info';
  ui.subtab = 'usage';
  renderSubtabs();
  await render();
  const button = find();
  if (!button) {
    await api.debugLog('[SELFTEST] 갱신 버튼 실패 — 정보 서브탭 줄에 버튼이 없다');
    return;
  }

  button.click();
  const busy = await waitFor(() => find()?.disabled === true && find()?.textContent === '갱신 중…');
  const done = await waitFor(() => !ui.refreshing && find()?.disabled === false);
  const label = content.querySelector('.usage-refreshed')?.textContent ?? '';
  const { lastRefreshedLabel } = await api.infoUsage(ui.period);

  await api.debugLog(
    busy && done && find()?.textContent === '갱신' && label === `마지막 갱신 ${lastRefreshedLabel}`
      ? `[SELFTEST] 갱신 버튼            눌림 중 비활성 → 복귀, ${label}`
      : `[SELFTEST] 갱신 버튼 실패 — 비활성 ${busy}, 복귀 ${done}, 표시 '${label}'`,
  );
}

/**
 * 모든 화면과 서브탭을 순회하며 렌더 결과를 보고한다.
 *
 * 클릭 핸들러와 같은 경로(`selectScreen` → `render`)를 지나므로, 어느 화면이든 그리다
 * 실패하면 여기서 드러난다. 화면을 눈으로 볼 수 없는 환경에서 PROTO-003을 확인하는
 * 수단이다.
 */
async function runSelftest() {
  const walk = [
    ['info', 'summary'],
    ['info', 'usage'],
    ['settings', 'collect'],
    ['settings', 'display'],
    ['settings', 'notifications'],
    ['settings', 'misc'],
    ['achievements', ''],
    ['demo', ''],
  ];

  for (const [screen, subtab] of walk) {
    let error = null;
    try {
      ui.screen = screen;
      ui.subtab = subtab;
      renderSubtabs();
      await render();
      // 화면을 그리다 실패하면 render()가 오류 블록을 넣는다. 그것도 실패로 센다.
      const failed = content.querySelector('.error-block');
      if (failed && screen !== 'info') error = failed.textContent;
    } catch (thrown) {
      error = String(thrown);
    }
    const name = subtab ? `${screen}/${subtab}` : screen;
    await api.debugLog(
      error
        ? `[SELFTEST] ${name} 실패 — ${error}`
        : `[SELFTEST] ${name.padEnd(22)} 노드 ${String(content.querySelectorAll('*').length).padStart(3)}개  ` +
            `내용 ${content.scrollHeight}px / 보이는 영역 ${content.clientHeight}px  ` +
            `${content.scrollHeight > content.clientHeight + 1 ? '스크롤 있음' : '스크롤 없음'}`,
    );
  }

  // 모델 전체 보기 토글이 실제로 행 수를 늘리는지 확인한다(INFO-006).
  ui.screen = 'info';
  ui.subtab = 'usage';
  ui.expanded = true; // 모델별은 `자세히` 안에 있다.
  ui.modelsExpanded = false;
  await render();
  const collapsed = content.querySelectorAll('.model-row').length;
  ui.modelsExpanded = true;
  await render();
  const expanded = content.querySelectorAll('.model-row').length;
  // 모델이 5개 이하면 `전체 보기` 자체가 없다. 실제 수집기로 막 설치한 상태가 그렇다.
  const { modelCount } = await api.infoUsage(ui.period);
  await api.debugLog(
    modelCount <= 5
      ? `[SELFTEST] info/usage 모델 ${modelCount}개 — 전체 보기 없음, 토글 확인 생략`
      : expanded > collapsed
        ? `[SELFTEST] info/usage 모델 접힘 ${collapsed}행 → 펼침 ${expanded}행`
        : `[SELFTEST] info/usage 실패 — 전체 보기가 행을 늘리지 못했다`,
  );

  ui.expanded = false;
  ui.modelsExpanded = false;

  await selftestInfoLayout();
  await selftestRefreshButton();

  /*
   * 화면 버튼이 실제로 화면을 바꾸는지 확인한다.
   *
   * 렌더러는 순수 JS라 선택자가 어긋나도 타입 검사가 잡지 못한다. 정보는 텍스트 탭,
   * 설정·업적은 아이콘 버튼이라 둘이 같은 배선을 공유하는지 눈으로 볼 수 없는
   * 환경에서 확인할 수단이 필요하다.
   */
  for (const button of document.querySelectorAll('[data-screen]')) {
    const target = button.dataset.screen;
    button.click();
    const moved = ui.screen === target;
    const marked = button.getAttribute('aria-selected') === 'true';
    await api.debugLog(
      moved && marked
        ? `[SELFTEST] 화면 버튼 ${target.padEnd(13)} 이동·선택 표시 정상`
        : `[SELFTEST] 화면 버튼 ${target} 실패 — 화면 ${ui.screen}, 선택 ${button.getAttribute('aria-selected')}`,
    );
  }

  /*
   * 프로필 초상화가 실제 에셋으로 그려졌는지 확인한다.
   *
   * 주소는 앱이 만들어 창을 넘어온다. 순수 JS 렌더러라 타입 검사가 닿지 않고, 경로가
   * 어긋나도 조용히 빈 상자가 될 뿐이라 여기서 본다.
   */
  ui.screen = 'info';
  ui.subtab = 'summary';
  await render();
  const thumb = content.querySelector('.pet-thumb img');
  if (thumb && !thumb.complete) {
    await new Promise((done) => {
      thumb.onload = done;
      thumb.onerror = done;
    });
  }
  // 고른 펫이 없는 설치에서는 초상화가 없는 게 맞다. 그걸 실패로 세면 새 DB 에서 매번 붉다.
  const summaryData = await api.infoSummary();
  const noActivePet =
    !summaryData.profile.activePet.error && summaryData.profile.activePet.value === null;
  await api.debugLog(
    thumb && thumb.naturalWidth > 0
      ? `[SELFTEST] 프로필 초상화     ${thumb.naturalWidth}×${thumb.naturalHeight} 실제 에셋`
      : noActivePet
        ? '[SELFTEST] 프로필 초상화     활성 펫 없음 — 빈 상태'
        : `[SELFTEST] 프로필 초상화 실패 — ${thumb ? '주소는 왔는데 못 읽었다' : '자리표시 글리프로 떨어졌다'}`,
  );

  /*
   * 설정 전용 모드가 실제로 다른 탭을 감추고, 되돌아올 수 있는지 확인한다.
   *
   * 나가는 길이 끊기면 사용자가 설정에 갇힌다. 화면을 눈으로 볼 수 없으므로
   * 여기서 확인한다.
   */
  selectScreen('settings');
  const tabsHidden = [...document.querySelectorAll('.screen-tab')].every((tab) => tab.hidden);
  const escapeShown = !document.getElementById('back-button').hidden;
  document.getElementById('back-button').click();
  const returned = ui.screen === 'info';
  const tabsBack = [...document.querySelectorAll('.screen-tab')].every((tab) => !tab.hidden);
  await api.debugLog(
    tabsHidden && escapeShown && returned && tabsBack
      ? '[SELFTEST] 설정 전용 모드   탭 감춤·나가기 표시·복귀 정상'
      : `[SELFTEST] 설정 전용 모드 실패 — 감춤 ${tabsHidden}, 나가기 ${escapeShown}, 복귀 ${returned}, 탭 복원 ${tabsBack}`,
  );

  selectScreen('info');
}
