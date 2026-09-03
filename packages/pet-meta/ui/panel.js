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

/** 큰 토큰 수를 짧게. 400px 폭에서 자리수가 넘치지 않게 한다. */
function compact(value) {
  const n = Number(value ?? 0);
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1)}만`;
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

/* ---------- 화면 상태 ---------- */

const SUBTABS = {
  info: [
    ['summary', '요약'],
    ['usage', '사용량'],
    ['performance', '실적'],
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
};

const content = document.getElementById('content');
const subtabBar = document.getElementById('subtabs');

/* ---------- 라우팅 ---------- */

function selectScreen(screen, { resetSubtab = true } = {}) {
  ui.screen = screen;
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
            renderSubtabs();
            render();
          },
        },
      }),
    );
  }
}

async function render() {
  content.classList.remove('no-scroll');
  try {
    if (ui.screen === 'info') {
      if (ui.subtab === 'summary') return await renderSummary();
      if (ui.subtab === 'usage') return await renderUsage();
      return await renderPerformance();
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

/* ---------- 정보 · 요약 ---------- */

async function renderSummary() {
  const data = await api.infoSummary();
  // INFO-001: 요약은 스크롤 없이 보인다.
  content.classList.add('no-scroll');

  const petThumb = el('div', { class: 'pet-thumb' }, [
    el('span', {
      text: data.profile.petName.error ? '❓' : '🐾',
      attrs: { style: 'font-size:16px' },
    }),
  ]);

  /*
   * 조련사 이름이 없으므로 펫이 프로필의 머리줄이다.
   *
   * 계정도 동기화도 없는 앱에서 사용자를 부를 이름은 아무것도 식별하지 않았다.
   * 정체성은 화면에 떠 있는 펫이 이미 맡고 있다.
   */
  const profile = el('div', { class: 'card' }, [
    el('div', { class: 'profile' }, [
      petThumb,
      el('div', { class: 'profile-body' }, [
        el('div', {
          class: 'pet-headline',
          text: data.profile.petName.error
            ? '펫 정보를 불러오지 못했어요'
            : `${data.profile.petName.value} · Lv.${data.profile.petLevel.value}`,
        }),
        el('div', { class: 'profile-meta' }, [
          data.profile.equippedTitle
            ? el('span', { class: 'chip', text: data.profile.equippedTitle })
            : el('span', { class: 'chip plain', text: '칭호 없음' }),
          el('span', { class: 'chip plain', text: data.profile.deviceLabel }),
        ]),
        expRow(data.profile.experience),
      ]),
    ]),
  ]);

  /*
   * 화면에서 가장 강조되는 값. 사용자가 지금 쓸 수 있는 재화다.
   *
   * 가이드가 글자 크기를 16px까지만 허용하므로 크기만으로는 부족하다. 자기 카드를
   * 독차지하고, 금색을 쓰고(획득·보상용 색), 맨 위에 놓아 위계를 만든다.
   */
  const hero = el('div', { class: 'card hero' }, [
    el('div', { class: 'hero-label', text: '사용 가능 토큰' }),
    el('div', { class: 'hero-figure' }, [
      data.availableTokens.error
        ? el('span', { class: 'hero-value error', text: '⚠ 조회 실패' })
        : el('span', {
            class: 'hero-value',
            text: data.availableTokens.value.toLocaleString('ko-KR'),
          }),
      el('span', {
        class: 'hero-sub',
        text: data.todayEarnedCoins.error ? '오늘 ⚠' : `오늘 +${data.todayEarnedCoins.value}`,
      }),
    ]),
  ]);

  /*
   * 누적과 오늘을 한 카드에 담는다.
   *
   * 따로 두면 카드 테두리·안쪽 여백·바깥 여백이 한 벌 더 붙어 요약이 패널 높이를
   * 넘긴다. 패널 크기는 기획서 4.2가 고정하고 요약은 스크롤이 없어야 하므로
   * (INFO-001), 남는 예산을 여기서 만든다. 보여주는 수치는 그대로다.
   */
  const numbers = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '설치 이후 누적' }),
      el('span', { text: data.hasNoRecords ? '기록이 아직 없습니다' : '' }),
    ]),
    el('div', { class: 'stat-grid' }, [
      stat('관측 토큰', el('div', { class: 'value', text: compact(data.totalObservedTokens) })),
      stat('보유 펫', fieldValue(data.ownedPets)),
      stat(
        '도감',
        data.dexOwned.error
          ? el('div', { class: 'value error', text: '⚠ 조회 실패' })
          : el('div', {
              class: 'value small',
              text: `${data.dexOwned.value} / ${data.dexTotal.value}`,
            }),
      ),
    ]),
    el('h2', { class: 'section-title spaced' }, [el('span', { text: '오늘' })]),
    // 오늘 획득 코인은 위 히어로가 `오늘 +N`으로 이미 보여준다. 여기서 또 쓰지 않는다.
    el('div', { class: 'stat-grid two' }, [
      stat('관측 토큰', el('div', { class: 'value', text: compact(data.todayObservedTokens) })),
      stat('함께한 시간', el('div', { class: 'value small', text: data.togetherLabel })),
    ]),
  ]);

  const achievements = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '업적' }),
      el('span', {
        text: `${data.achievementsUnlocked} / ${data.achievementsTotal} · ${data.completionPercent}%`,
      }),
    ]),
    bar(data.achievementsTotal ? data.achievementsUnlocked / data.achievementsTotal : 0),
  ]);

  content.replaceChildren(hero, profile, numbers, achievements);
}

/* ---------- 정보 · 사용량 ---------- */

async function renderUsage() {
  const data = await api.infoUsage(ui.period);

  const filters = el(
    'div',
    { class: 'filter-bar' },
    [
      ['today', '오늘'],
      ['week', '주'],
      ['month', '달'],
      ['all', '전체'],
    ].map(([key, label]) =>
      el('button', {
        class: 'subtab',
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

  // 기획서 5.2: 제목 옆에 `최근 12주`를 명시해 기간 필터와 혼동하지 않게 한다.
  const grassCard = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '사용량 잔디' }),
      el('span', { text: '최근 12주' }),
    ]),
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
              title: cell.future ? cell.date : `${cell.date} · ${num(cell.observed)} 토큰`,
            }),
          ),
        ),
      ),
    ),
    el('div', { class: 'grass-legend' }, [
      el('span', { text: '적음' }),
      el('div', { class: 'grass-cell' }),
      el('div', { class: 'grass-cell l1' }),
      el('div', { class: 'grass-cell l2' }),
      el('div', { class: 'grass-cell l3' }),
      el('div', { class: 'grass-cell l4' }),
      el('span', { text: '많음' }),
    ]),
  ]);

  const toolsCard = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '도구별' }),
      el('span', { text: `${compact(data.periodObserved)} 토큰` }),
    ]),
    ...(data.tools.length
      ? data.tools.map((row) =>
          el('div', { class: 'row' }, [
            el('span', { class: 'badge', text: row.providerLabel }),
            el('span', { class: 'name' }, [bar(row.sharePercent / 100)]),
            row.paused ? el('span', { class: 'status paused', text: row.statusLabel }) : null,
            el('span', { class: 'num', text: compact(row.observed) }),
            el('span', { class: 'pct', text: `${row.sharePercent}%` }),
          ]),
        )
      : [el('div', { class: 'empty', text: '이 기간에 기록이 없습니다' })]),
  ]);

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
            el('span', { class: 'num', text: compact(row.observed) }),
            el('span', { class: 'pct', text: `${row.sharePercent}%` }),
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

  content.replaceChildren(filters, grassCard, toolsCard, modelsCard);
}

/* ---------- 정보 · 실적 ---------- */

async function renderPerformance() {
  const data = await api.infoPerformance();

  const tiles = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [el('span', { text: '실적' })]),
    el(
      'div',
      { class: 'stat-grid' },
      data.tiles.map((tile) =>
        el('div', { class: 'stat', title: `소유 도메인: ${tile.owner}` }, [
          el('div', { class: 'label', text: tile.label }),
          fieldValue(tile.value, compact),
          el('div', { class: 'owner-tag', text: tile.owner }),
        ]),
      ),
    ),
  ]);

  const ledgerBody = data.ledger.error
    ? [el('div', { class: 'error-block', text: data.ledger.error })]
    : data.ledger.value.length
      ? data.ledger.value.map((entry) =>
          el('div', { class: 'ledger-row' }, [
            el('span', { class: 'when', text: entry.occurredAt }),
            el('span', { class: 'why', text: entry.reason, title: entry.reason }),
            el('span', {
              class: `delta ${entry.delta >= 0 ? 'plus' : 'minus'}`,
              text: `${entry.delta >= 0 ? '+' : ''}${num(entry.delta)}`,
            }),
          ]),
        )
      : [el('div', { class: 'empty', text: '원장 기록이 아직 없습니다' })];

  const ledger = el('div', { class: 'card' }, [
    el('h2', { class: 'section-title' }, [
      el('span', { text: '코인 원장' }),
      el('span', { text: '최신 20건' }),
    ]),
    ...ledgerBody,
  ]);

  content.replaceChildren(tiles, ledger);
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

    content.replaceChildren(
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
    content.replaceChildren(
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
    content.replaceChildren(
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
  content.replaceChildren(
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
        text: '후원은 게임 내 코인·칭호·트로피와 연결되지 않습니다',
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
          el('div', { class: 'medal', text: row.unlocked ? '🏅' : row.masked ? '?' : '🔒' }),
          el('div', { class: 'body' }, [
            el('div', { class: 'title-line' }, [
              el('span', { class: 'name', text: row.name }),
              row.tier ? el('span', { class: `tier ${row.tier}`, text: row.tier }) : null,
              el('span', { class: 'chip plain', text: row.categoryLabel }),
              row.rewardPending ? el('span', { class: 'pending', text: '보상 처리 중' }) : null,
            ]),
            el('div', { class: 'cond', text: row.condition }),
            el(
              'div',
              { class: 'rewards' },
              row.rewards.map((reward) => el('span', { class: 'chip plain', text: reward })),
            ),
            row.masked
              ? null
              : el('div', { class: 'progress-line' }, [
                  bar(row.target ? row.progress / row.target : 0),
                  el('span', { class: 'num', text: row.progressLabel }),
                ]),
          ]),
        ],
      ),
    ),
  );

  content.replaceChildren(filters, header, titleCard, list);
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
        text: 'collection · gacha · battle · overlay-growth가 아직 없어 손으로 발행합니다',
      }),
      el('div', { class: 'link-list', attrs: { style: 'margin-top:6px' } }, [
        demoButton('커먼 펫 획득', () => api.demoEvent('pet_common')),
        demoButton('에픽 펫 획득', () => api.demoEvent('pet_epic')),
        demoButton('커먼2→에픽 합성', () => api.demoEvent('fusion_miracle')),
        demoButton('전투 승리', () => api.demoEvent('battle_win')),
        demoButton('레벨업', () => api.demoEvent('levelup')),
        demoButton('도감 완성', () => api.demoEvent('dex_complete')),
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
    ['info', 'performance'],
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
  ui.modelsExpanded = false;
  await render();
  const collapsed = content.querySelectorAll('.model-row').length;
  ui.modelsExpanded = true;
  await render();
  const expanded = content.querySelectorAll('.model-row').length;
  await api.debugLog(
    expanded > collapsed
      ? `[SELFTEST] info/usage 모델 접힘 ${collapsed}행 → 펼침 ${expanded}행`
      : `[SELFTEST] info/usage 실패 — 전체 보기가 행을 늘리지 못했다`,
  );

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
