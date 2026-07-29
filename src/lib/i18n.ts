// Lightweight string catalog for UI internationalization (en / de / ja / ko).
// Client-safe and dependency-free: a flat key → per-locale map with {var}
// interpolation. Prototype scope: the phase/dependency track viewer. As pages
// adopt it, their strings move here; the locale itself comes from the `lang`
// search param today (a cookie or Accept-Language later — same `t()` calls).

export type Locale = 'en' | 'de' | 'ja' | 'ko';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
  { code: 'ja', label: 'JA' },
  { code: 'ko', label: 'KO' },
];

export function isLocale(x: unknown): x is Locale {
  return x === 'en' || x === 'de' || x === 'ja' || x === 'ko';
}

type Entry = Record<Locale, string>;

const STRINGS = {
  criticalChain: {
    en: 'Critical chain',
    de: 'Kritische Kette',
    ja: 'クリティカルチェーン',
    ko: '크리티컬 체인',
  },
  daysRemaining: {
    en: '≈{n} days remaining',
    de: '≈ noch {n} Tage',
    ja: '残り約{n}日',
    ko: '약 {n}일 남음',
  },
  statusDone: { en: 'Done', de: 'Abgeschlossen', ja: '完了', ko: '완료' },
  statusInProgress: { en: 'In Progress', de: 'In Arbeit', ja: '進行中', ko: '진행 중' },
  statusNotStarted: { en: 'Not Started', de: 'Nicht begonnen', ja: '未着手', ko: '시작 전' },
  constraint: { en: 'Constraint', de: 'Engpass', ja: '制約', ko: '제약' },
  noNote: {
    en: 'No update note yet.',
    de: 'Noch keine Update-Notiz.',
    ja: '更新メモはまだありません。',
    ko: '아직 업데이트 메모가 없습니다.',
  },
  update: { en: 'Update', de: 'Aktualisieren', ja: '更新', ko: '업데이트' },
  addPhase: { en: 'Add phase', de: 'Phase hinzufügen', ja: 'フェーズを追加', ko: '단계 추가' },
  newPhasePlaceholder: {
    en: 'New phase name…',
    de: 'Name der neuen Phase…',
    ja: '新しいフェーズ名…',
    ko: '새 단계 이름…',
  },
  afterOptional: {
    en: 'after… (optional)',
    de: 'nach… (optional)',
    ja: '…の後（任意）',
    ko: '…이후 (선택)',
  },
  after: { en: 'After', de: 'Nach', ja: '前提', ko: '선행' },
  enables: { en: 'Enables', de: 'Ermöglicht', ja: '後続', ko: '후속' },
  startingPhase: {
    en: 'nothing — a starting phase',
    de: 'nichts — eine Startphase',
    ja: 'なし — 開始フェーズ',
    ko: '없음 — 시작 단계',
  },
  noGoalYet: {
    en: 'No goal & definition of done yet —',
    de: 'Noch kein Ziel & keine Definition of Done —',
    ja: '目標と完了定義は未設定 —',
    ko: '목표와 완료 정의가 아직 없습니다 —',
  },
  addAfter: { en: '+ after…', de: '+ nach…', ja: '+ 前提を追加…', ko: '+ 선행 추가…' },
  addPartner: { en: '+ partner…', de: '+ Partner…', ja: '+ パートナー…', ko: '+ 파트너…' },
  role: { en: 'role', de: 'Rolle', ja: '役割', ko: '역할' },
  add: { en: 'Add', de: 'Hinzufügen', ja: '追加', ko: '추가' },
  removePhase: { en: 'Remove phase', de: 'Phase entfernen', ja: 'フェーズを削除', ko: '단계 제거' },
  removePhaseConfirm: {
    en: 'Remove the “{name}” phase and its entire history?',
    de: 'Phase „{name}“ und ihren gesamten Verlauf entfernen?',
    ja: 'フェーズ「{name}」とその履歴をすべて削除しますか？',
    ko: '“{name}” 단계와 전체 기록을 제거하시겠습니까?',
  },
  removeDependency: {
    en: 'Remove dependency',
    de: 'Abhängigkeit entfernen',
    ja: '依存関係を削除',
    ko: '의존성 제거',
  },
  removeName: { en: 'Remove {name}', de: '{name} entfernen', ja: '{name}を削除', ko: '{name} 제거' },
  skips: { en: 'skips {names}', de: 'überspringt {names}', ja: '{names}をスキップ', ko: '{names} 건너뜀' },
  legendBypass: {
    en: 'branch line — dependencies that skip phases; those sharing an end share one line',
    de: 'Zweiglinie — Abhängigkeiten, die Phasen überspringen; solche mit gemeinsamem Ende teilen sich eine Linie',
    ja: '支線 — フェーズをスキップする依存関係。端点を共有するものは1本の線にまとまります',
    ko: '지선 — 단계를 건너뛰는 의존성. 끝점을 공유하면 한 선을 함께 씁니다',
  },
  legendTrace: {
    en: 'click a station or a phase name to trace what feeds it and what waits on it',
    de: 'Auf eine Station oder einen Phasennamen klicken, um Zuflüsse und Wartende zu verfolgen',
    ja: '駅またはフェーズ名をクリックすると、前提と後続をたどれます',
    ko: '역이나 단계 이름을 클릭하면 선행과 후속을 따라갈 수 있습니다',
  },
  traceHint: {
    en: 'click to trace its dependencies',
    de: 'klicken, um Abhängigkeiten zu verfolgen',
    ja: 'クリックで依存関係をたどる',
    ko: '클릭하면 의존성을 추적합니다',
  },
  tracingLabel: { en: 'Tracing', de: 'Verfolgt', ja: 'トレース中', ko: '추적 중' },
  tracingCounts: {
    en: '{u} before · {d} after',
    de: '{u} davor · {d} danach',
    ja: '前提{u}件・後続{d}件',
    ko: '선행 {u}개 · 후속 {d}개',
  },
  clearTrace: { en: 'Clear', de: 'Aufheben', ja: '解除', ko: '해제' },
  legendTrack: {
    en: 'track darkens when the preceding phase is done',
    de: 'Strecke färbt sich, wenn die vorangehende Phase abgeschlossen ist',
    ja: '線路は先行フェーズの完了で塗られます',
    ko: '트랙은 선행 단계가 완료되면 채워집니다',
  },
  figuringItOut: { en: 'Figuring it out', de: 'Klären', ja: '模索中', ko: '파악 중' },
  makingItHappen: { en: 'Making it happen', de: 'Umsetzen', ja: '実行中', ko: '실행 중' },
  dialogTitle: {
    en: 'Phase progress update',
    de: 'Phasenfortschritt aktualisieren',
    ja: 'フェーズ進捗の更新',
    ko: '단계 진행 업데이트',
  },
  dragHint: {
    en: 'Drag the dot to set progress',
    de: 'Punkt ziehen, um den Fortschritt zu setzen',
    ja: 'ドットをドラッグして進捗を設定',
    ko: '점을 드래그하여 진행률 설정',
  },
  noteFieldLabel: {
    en: 'Update — what changed (required)',
    de: 'Update — was hat sich geändert (erforderlich)',
    ja: '更新 — 変更内容（必須）',
    ko: '업데이트 — 변경 내용 (필수)',
  },
  noteRequired: {
    en: 'A progress change needs a note — say what changed.',
    de: 'Eine Fortschrittsänderung braucht eine Notiz — was hat sich geändert?',
    ja: '進捗の更新にはメモが必要です。何が変わったか記入してください。',
    ko: '진행 업데이트에는 메모가 필요합니다. 무엇이 바뀌었는지 적어주세요.',
  },
  editPhases: {
    en: 'Edit phases →',
    de: 'Phasen bearbeiten →',
    ja: 'フェーズを編集 →',
    ko: '단계 편집 →',
  },
  constraintWhyChain: {
    en: 'first unfinished stop on the critical chain — ≈{n} days of chain work start here',
    de: 'erster unfertiger Halt der kritischen Kette — hier beginnen ≈{n} Tage Kettenarbeit',
    ja: 'クリティカルチェーン上の最初の未完了フェーズ — ここから約{n}日のチェーン作業が始まります',
    ko: '크리티컬 체인의 첫 미완료 단계 — 여기서 약 {n}일의 체인 작업이 시작됩니다',
  },
  constraintWhyResource: {
    en: 'resource contention (+n = active phases elsewhere): {items}',
    de: 'Ressourcenkonflikt (+n = aktive Phasen anderswo): {items}',
    ja: 'リソース競合（+n = 他で進行中のフェーズ数）: {items}',
    ko: '리소스 경합 (+n = 다른 곳의 활성 단계 수): {items}',
  },
  constraintWhyOverPlan: {
    en: 'over plan — {e} elapsed of {p} planned',
    de: 'über Plan — {e} vergangen von {p} geplant',
    ja: '計画超過 — 予定{p}のうち{e}経過',
    ko: '계획 초과 — 계획 {p} 중 {e} 경과',
  },
  contendedTitle: {
    en: '{name} — also on {n} active phase(s) in other programs',
    de: '{name} — außerdem in {n} aktiven Phase(n) anderer Programme',
    ja: '{name} — 他プログラムのアクティブなフェーズ{n}件も担当',
    ko: '{name} — 다른 프로그램의 활성 단계 {n}개도 담당',
  },
  legendConstraint: {
    en: 'constraint',
    de: 'Engpass',
    ja: '制約',
    ko: '제약',
  },
  notePlaceholder: {
    en: 'e.g. Cleared the codec blocker; entering integration.',
    de: 'z. B. Codec-Blocker beseitigt; Integration beginnt.',
    ja: '例: コーデックの問題を解消し、統合段階へ。',
    ko: '예: 코덱 이슈 해결, 통합 단계 진입.',
  },
  cancel: { en: 'Cancel', de: 'Abbrechen', ja: 'キャンセル', ko: '취소' },
  save: { en: 'Save Update', de: 'Update speichern', ja: '保存', ko: '저장' },
  saving: { en: 'Saving…', de: 'Speichern…', ja: '保存中…', ko: '저장 중…' },
  saved: { en: 'Saved', de: 'Gespeichert', ja: '保存済み', ko: '저장됨' },
  saveFailed: {
    en: 'Save failed — try again',
    de: 'Speichern fehlgeschlagen — bitte erneut versuchen',
    ja: '保存に失敗しました — もう一度お試しください',
    ko: '저장 실패 — 다시 시도하세요',
  },
  partnerToInvolve: {
    en: 'Partner to involve',
    de: 'Zu beteiligender Partner',
    ja: '参加させるパートナー',
    ko: '참여시킬 파트너',
  },
  roleOptional: { en: 'Role (optional)', de: 'Rolle (optional)', ja: '役割（任意）', ko: '역할 (선택)' },
  addDependency: {
    en: 'Add a dependency',
    de: 'Abhängigkeit hinzufügen',
    ja: '依存関係を追加',
    ko: '의존성 추가',
  },
  newPhaseName: {
    en: 'New phase name',
    de: 'Name der neuen Phase',
    ja: '新しいフェーズ名',
    ko: '새 단계 이름',
  },
  afterPhaseOptional: {
    en: 'After phase (optional)',
    de: 'Nach Phase (optional)',
    ja: '先行フェーズ（任意）',
    ko: '선행 단계 (선택)',
  },
  statusUpdate: { en: 'Status update', de: 'Statusupdate', ja: 'ステータス更新', ko: '상태 업데이트' },
  edit: { en: 'Edit', de: 'Bearbeiten', ja: '編集', ko: '편집' },
  closeEdit: { en: 'Close', de: 'Schließen', ja: '閉じる', ko: '닫기' },
  activities: { en: 'Activities', de: 'Aktivitäten', ja: 'アクティビティ', ko: '활동' },
  pendingCount: { en: '{n} pending', de: '{n} offen', ja: '未処理{n}件', ko: '대기 {n}건' },
  noActivities: {
    en: 'no pending activities',
    de: 'keine offenen Aktivitäten',
    ja: '未処理のアクティビティなし',
    ko: '대기 중인 활동 없음',
  },
  googlerFocus: { en: 'Googler focus', de: 'Googler-Fokus', ja: 'Googlerの注力', ko: '구글러 포커스' },
  plannedElapsed: {
    en: '{p} planned · {e} elapsed',
    de: '{p} geplant · {e} bisher',
    ja: '予定{p}・経過{e}',
    ko: '계획 {p} · 경과 {e}',
  },
  plannedTook: {
    en: '{p} planned · took {e}',
    de: '{p} geplant · {e} gebraucht',
    ja: '予定{p}・所要{e}',
    ko: '계획 {p} · 소요 {e}',
  },
  plannedOnly: { en: '{p} planned', de: '{p} geplant', ja: '予定{p}', ko: '계획 {p}' },
  weeksUnit: { en: '{n}w', de: '{n} Wo.', ja: '{n}週', ko: '{n}주' },
  paceEarly: { en: '{d} early', de: '{d} früher', ja: '{d}前倒し', ko: '{d} 단축' },
  paceOver: { en: '{d} over plan', de: '{d} über Plan', ja: '計画超過{d}', ko: '계획 초과 {d}' },
  expandAll: { en: 'Expand diagram', de: 'Diagramm ausklappen', ja: '図を展開', ko: '다이어그램 펼치기' },
  collapseAll: { en: 'Collapse diagram', de: 'Diagramm einklappen', ja: '図を折りたたむ', ko: '다이어그램 접기' },
  // Shown WHILE the tracks are put away: absent ink must never be mistaken for
  // absent dependencies (design.md — a missing line means "no relationship").
  tracksHidden: { en: 'Dependency tracks hidden', de: 'Abhängigkeitsstrecken ausgeblendet', ja: '依存トラックは非表示', ko: '의존성 트랙 숨김' },
  showTracks: { en: 'Show', de: 'Einblenden', ja: '表示', ko: '표시' },
  hideTracks: { en: 'Hide tracks', de: 'Strecken ausblenden', ja: 'トラックを非表示', ko: '트랙 숨기기' },
  showTracksAction: { en: 'Show tracks', de: 'Strecken einblenden', ja: 'トラックを表示', ko: '트랙 표시' },
  phaseActions: {
    en: 'Phase actions',
    de: 'Phasen-Aktionen',
    ja: 'フェーズ操作',
    ko: '단계 작업',
  },
  backToPhases: { en: '← Phases', de: '← Phasen', ja: '← フェーズ', ko: '← 단계' },
  history: { en: 'History', de: 'Verlauf', ja: '履歴', ko: '기록' },
  partnersLabel: { en: 'Partners', de: 'Partner', ja: 'パートナー', ko: '파트너' },
  peopleLabel: { en: 'People', de: 'Personen', ja: '担当者', ko: '관련 인원' },
  details: { en: 'Details', de: 'Details', ja: '詳細', ko: '상세' },
  involved: { en: 'Involved', de: 'Beteiligt', ja: '関係者', ko: '참여' },
  involvementLabel: { en: 'Involvement', de: 'Beteiligung', ja: '関与', ko: '참여' },
  involvementAfterSave: {
    en: 'Save the phase before adding partners or people.',
    de: 'Phase speichern, bevor Partner oder Personen hinzugefügt werden.',
    ja: 'パートナーや担当者を追加する前にフェーズを保存してください。',
    ko: '파트너나 사람을 추가하기 전에 단계를 저장하세요.',
  },
  personToInvolve: {
    en: 'Person to involve',
    de: 'Zu beteiligende Person',
    ja: '参加させる担当者',
    ko: '참여시킬 사람',
  },
  addPerson: { en: '+ person…', de: '+ Person…', ja: '+ 担当者…', ko: '+ 사람…' },
  googleFocusLabel: { en: 'Google focus', de: 'Google-Fokus', ja: 'Googleの注力', ko: 'Google 포커스' },

  // ---- global nav + shell ----
  navEcosystem: { en: 'Ecosystem', de: 'Ökosystem', ja: 'エコシステム', ko: '에코시스템' },
  navPrograms: { en: 'Programs', de: 'Programme', ja: 'プログラム', ko: '프로그램' },
  navPartners: { en: 'Partners', de: 'Partner', ja: 'パートナー', ko: '파트너' },
  navMe: { en: 'Me', de: 'Ich', ja: 'マイページ', ko: '내 정보' },
  navMore: { en: 'More', de: 'Mehr', ja: 'その他', ko: '더 보기' },
  navActivity: { en: 'Activity', de: 'Aktivität', ja: 'アクティビティ', ko: '활동' },
  navTemplates: { en: 'Templates', de: 'Vorlagen', ja: 'テンプレート', ko: '템플릿' },
  navDevConsole: { en: 'Dev Console', de: 'Dev-Konsole', ja: '開発コンソール', ko: '개발 콘솔' },
  signIn: { en: 'Sign in', de: 'Anmelden', ja: 'ログイン', ko: '로그인' },
  signOut: { en: 'Sign out', de: 'Abmelden', ja: 'ログアウト', ko: '로그아웃' },
  searchGlobalAria: {
    en: 'Search partners, programs, people',
    de: 'Partner, Programme, Personen suchen',
    ja: 'パートナー・プログラム・担当者を検索',
    ko: '파트너, 프로그램, 사람 검색',
  },
  searchGlobalPlaceholder: {
    en: "Search partners, programs, people… (Press '/')",
    de: "Partner, Programme, Personen suchen… ('/' drücken)",
    ja: "パートナー・プログラム・担当者を検索…（'/'キー）",
    ko: "파트너, 프로그램, 사람 검색… ('/' 키)",
  },
  searchNoResults: {
    en: 'No results found for “{q}”',
    de: 'Keine Ergebnisse für „{q}“',
    ja: '「{q}」に一致する結果はありません',
    ko: '“{q}”에 대한 결과가 없습니다',
  },
  searchSeeAll: {
    en: 'See all results →',
    de: 'Alle Ergebnisse anzeigen →',
    ja: 'すべての結果を表示 →',
    ko: '모든 결과 보기 →',
  },

  // ---- project status dashboard (sidebar) ----
  progressHealth: { en: 'Progress & Health', de: 'Fortschritt & Status', ja: '進捗と健全性', ko: '진행 및 상태' },
  // deliberately just "Phases" — the hill chart speaks for itself
  phasesCard: { en: 'Phases', de: 'Phasen', ja: 'フェーズ', ko: '단계' },
  blockersDecisions: { en: 'Blockers & Decisions', de: 'Blocker & Entscheidungen', ja: 'ブロッカーと意思決定', ko: '블로커 및 의사결정' },
  pendingIssues: { en: 'Pending integration issues', de: 'Offene Integrationsprobleme', ja: '未解決の統合課題', ko: '미해결 통합 이슈' },
  projectMetadata: { en: 'Program Metadata', de: 'Programm-Metadaten', ja: 'プログラム情報', ko: '프로그램 메타데이터' },
  suppliersLabel: { en: 'Suppliers', de: 'Zulieferer', ja: 'サプライヤー', ko: '공급업체' },
  googlerOwner: { en: 'Googler Owner', de: 'Googler-Verantwortlicher', ja: '担当Googler', ko: '담당 구글러' },
  sopTarget: { en: 'SOP Target', de: 'SOP-Ziel', ja: 'SOP目標', ko: 'SOP 목표' },
  sopForecast: { en: 'est. {d}', de: 'vorauss. {d}', ja: '予測 {d}', ko: '예상 {d}' },
  sopDate: { en: 'SOP Date', de: 'SOP-Datum', ja: 'SOP日付', ko: 'SOP 날짜' },
  targetVolume: { en: '12M Target Volume', de: '12M-Zielvolumen', ja: '12ヶ月目標台数', ko: '12개월 목표 물량' },
  none: { en: 'None', de: 'Keine', ja: 'なし', ko: '없음' },
  assignOwner: { en: 'Assign owner — required', de: 'Owner zuweisen — erforderlich', ja: 'オーナー割当が必要', ko: '담당자 지정 필요' },
  undecided: { en: 'Undecided', de: 'Offen', ja: '未定', ko: '미정' },
  notSet: { en: 'Not Set', de: 'Nicht gesetzt', ja: '未設定', ko: '설정 안 됨' },
  editMetadata: { en: 'Edit Program Metadata', de: 'Programm-Metadaten bearbeiten', ja: 'プログラム情報を編集', ko: '프로그램 메타데이터 편집' },
  updateNoteOptional: { en: 'Update Note (Optional)', de: 'Update-Notiz (optional)', ja: '更新メモ（任意）', ko: '업데이트 메모 (선택)' },
  metadataNotesPlaceholder: { en: 'Metadata change notes', de: 'Notizen zur Metadaten-Änderung', ja: 'メタデータ変更のメモ', ko: '메타데이터 변경 메모' },
  saveSettings: { en: 'Save Settings', de: 'Einstellungen speichern', ja: '設定を保存', ko: '설정 저장' },

  // ---- gauges (needle + hill dialogs) ----
  weeklyUpdate: { en: 'Weekly program update', de: 'Wöchentliches Programm-Update', ja: '週次プログラム更新', ko: '주간 프로그램 업데이트' },
  healthLabel: { en: 'Health', de: 'Status', ja: '健全性', ko: '상태' },
  dragNeedleHint: { en: 'Drag the needle to set progress', de: 'Nadel ziehen, um den Fortschritt zu setzen', ja: '針をドラッグして進捗を設定', ko: '바늘을 드래그하여 진행률 설정' },
  updateWhatWhy: { en: 'Update — what changed & why (required)', de: 'Update — was & warum (erforderlich)', ja: '更新 — 変更内容と理由（必須）', ko: '업데이트 — 변경 내용과 이유 (필수)' },
  updateNeedsNote: { en: 'An update needs a note — say what changed.', de: 'Ein Update braucht eine Notiz — was hat sich geändert?', ja: '更新にはメモが必要です。何が変わったか記入してください。', ko: '업데이트에는 메모가 필요합니다. 무엇이 바뀌었는지 적어주세요.' },
  needleNotePlaceholder: { en: 'e.g. Deploying first week of cooldown; one blocker on export.', de: 'z. B. Deployment in der ersten Cooldown-Woche; ein Blocker beim Export.', ja: '例: クールダウン第1週にデプロイ。エクスポートに1件のブロッカー。', ko: '예: 쿨다운 첫 주에 배포, 내보내기에 블로커 1건.' },
  programProgressAria: { en: 'Program progress', de: 'Programmfortschritt', ja: 'プログラム進捗', ko: '프로그램 진행률' },
  updatedOn: { en: 'Updated {d}', de: 'Aktualisiert {d}', ja: '{d} 更新', ko: '{d} 업데이트' },
  noPhasesYet: { en: 'No phases yet.', de: 'Noch keine Phasen.', ja: 'フェーズはまだありません。', ko: '아직 단계가 없습니다.' },
  hillAria: { en: 'Phase progress on the hill', de: 'Phasenfortschritt auf dem Hügel', ja: 'ヒル上のフェーズ進捗', ko: '힐 차트의 단계 진행률' },
  allPeopleInvolved: {
    en: 'everyone known is already involved',
    de: 'alle bekannten Personen sind bereits beteiligt',
    ja: '登録済みの担当者は全員参加済みです',
    ko: '등록된 모든 사람이 이미 참여 중입니다',
  },
  // ---- summary-component drill-downs ----
  activeOnly: { en: 'Active only', de: 'Nur aktive', ja: 'アクティブのみ', ko: '활성만' },
  viewActivePrograms: {
    en: 'View active programs',
    de: 'Aktive Programme anzeigen',
    ja: 'アクティブなプログラムを表示',
    ko: '활성 프로그램 보기',
  },
  viewAllPrograms: {
    en: 'View all programs',
    de: 'Alle Programme anzeigen',
    ja: 'すべてのプログラムを表示',
    ko: '모든 프로그램 보기',
  },
  shippingIn: { en: 'Shipping in {q}', de: 'SOP in {q}', ja: '{q}にSOP', ko: '{q} SOP 예정' },
  shippingNone: {
    en: 'No programs ship in this quarter.',
    de: 'In diesem Quartal erreicht kein Programm SOP.',
    ja: 'この四半期にSOPを迎えるプログラムはありません。',
    ko: '이 분기에 SOP되는 프로그램이 없습니다.',
  },
  // ---- SOP target + products + ecosystem capacity ----
  sopMonthLabel: {
    en: 'Target SOP (month — last day assumed)',
    de: 'Ziel-SOP (Monat — letzter Tag angenommen)',
    ja: '目標SOP（月 — 月末日と仮定）',
    ko: '목표 SOP (월 — 말일 기준)',
  },
  productsLabel: { en: 'Included products', de: 'Enthaltene Produkte', ja: '含まれる製品', ko: '포함 제품' },
  productGas: { en: 'GAS (Google Automotive Services)', de: 'GAS (Google Automotive Services)', ja: 'GAS（Google Automotive Services）', ko: 'GAS (Google Automotive Services)' },
  productGbi: { en: 'Google Built-In (GBI)', de: 'Google Built-In (GBI)', ja: 'Google Built-In（GBI）', ko: 'Google Built-In (GBI)' },
  productDigitalKey: { en: 'Digital Key', de: 'Digital Key', ja: 'デジタルキー', ko: '디지털 키' },
  capacityTitle: {
    en: 'Cumulative capacity by product',
    de: 'Kumulative Kapazität nach Produkt',
    ja: '製品別累積キャパシティ',
    ko: '제품별 누적 용량',
  },
  capacityExpand: { en: 'Expand', de: 'Vergrößern', ja: '拡大表示', ko: '확대' },
  capacityProductNote: {
    en: 'Product units in consumer hands — a vehicle counts once per product it carries. Click a quarter to see its programs.',
    de: 'Produkteinheiten im Feld — ein Fahrzeug zählt je enthaltenem Produkt einmal. Quartal anklicken für die Programme.',
    ja: '消費者の手元にある製品数 — 1台は搭載製品ごとに1回数えます。四半期をクリックするとプログラムを表示。',
    ko: '소비자 보유 제품 수 — 차량은 탑재 제품마다 한 번씩 계산됩니다. 분기를 클릭하면 프로그램이 표시됩니다.',
  },
  productAaos: {
    en: 'Android Automotive OS (AAOS)',
    de: 'Android Automotive OS (AAOS)',
    ja: 'Android Automotive OS（AAOS）',
    ko: 'Android Automotive OS (AAOS)',
  },
  productAap: { en: 'Android Auto (AAP)', de: 'Android Auto (AAP)', ja: 'Android Auto（AAP）', ko: 'Android Auto (AAP)' },
  capacityExcluded: {
    en: '{n} program(s) missing an SOP target — not plotted',
    de: '{n} Programm(e) ohne SOP-Ziel — nicht dargestellt',
    ja: 'SOP目標のないプログラム{n}件 — 未表示',
    ko: 'SOP 목표가 없는 프로그램 {n}개 — 미표시',
  },
  capacityEmpty: {
    en: 'No dated programs yet — set SOP targets to see capacity come online.',
    de: 'Noch keine terminierten Programme — SOP-Ziele setzen, um Kapazität zu sehen.',
    ja: 'SOP設定済みのプログラムがありません。SOP目標を設定すると表示されます。',
    ko: '아직 SOP가 설정된 프로그램이 없습니다. SOP 목표를 설정하세요.',
  },
  statsActivePrograms: { en: 'Active programs', de: 'Aktive Programme', ja: 'アクティブなプログラム', ko: '활성 프로그램' },
  statsAllTime: { en: '{n} all time', de: '{n} insgesamt', ja: '累計{n}件', ko: '전체 {n}개' },
  // Ecosystem strip tile 2 — SOP buffer exhaustion (lib/sop.sopBufferRisk).
  statsSopAtRisk: { en: 'SOP at risk', de: 'SOP gefährdet', ja: 'SOP遅延リスク', ko: 'SOP 위험' },
  statsSopAtRiskTitle: {
    en: 'Active programs whose remaining critical-chain work no longer fits before their target SOP — the buffer is exhausted.',
    de: 'Aktive Programme, deren verbleibende Arbeit auf der kritischen Kette nicht mehr vor den SOP-Termin passt — der Puffer ist aufgebraucht.',
    ja: '残りのクリティカルチェーン作業が目標SOPに収まらなくなったアクティブなプログラム — バッファが尽きています。',
    ko: '남은 크리티컬 체인 작업이 목표 SOP 안에 들어가지 않는 활성 프로그램 — 버퍼가 소진되었습니다.',
  },
  statsSopOfDated: { en: 'of {n} with a target SOP', de: 'von {n} mit SOP-Ziel', ja: '目標SOPあり{n}件中', ko: '목표 SOP 보유 {n}개 중' },
  statsSopUndated: { en: '{n} without one', de: '{n} ohne', ja: '未設定{n}件', ko: '미설정 {n}개' },
  // Ecosystem strip tile 3 — partner relationship mix (lib/relationship.relationshipMix).
  statsRelationshipMix: { en: 'Partner relationships', de: 'Partnerbeziehungen', ja: 'パートナー関係', ko: '파트너 관계' },
  statsRelationshipMixAria: {
    en: 'Share of rated partner relationships by health class, critical (left) to exemplary (right).',
    de: 'Anteil der bewerteten Partnerbeziehungen je Gesundheitsklasse, kritisch (links) bis vorbildlich (rechts).',
    ja: '評価済みパートナー関係の健全度クラス別の割合、危機的（左）から模範的（右）まで。',
    ko: '평가된 파트너 관계의 상태 등급별 비율, 위기(왼쪽)에서 모범적(오른쪽)까지.',
  },
  // Phrased so it stays grammatical at any count — this catalog has no pluralization
  // (cf. '{n} days', '{n} units') and "1 partners" is not worth inventing one for.
  statsRelationshipSegment: {
    en: '{p} of rated partners ({n})',
    de: '{p} der bewerteten Partner ({n})',
    ja: '評価済みパートナーの{p}（{n}社）',
    ko: '평가된 파트너의 {p} ({n}개)',
  },
  statsRelationshipRated: { en: '{n} rated', de: '{n} bewertet', ja: '評価済み{n}社', ko: '평가 완료 {n}개' },
  statsRelationshipRatedTitle: { en: 'View rated partners', de: 'Bewertete Partner anzeigen', ja: '評価済みパートナーを表示', ko: '평가된 파트너 보기' },
  statsRelationshipUnrated: { en: '{n} unrated', de: '{n} unbewertet', ja: '未評価{n}社', ko: '미평가 {n}개' },
  statsRelationshipUnratedTitle: { en: 'View partners with no rating yet', de: 'Noch nicht bewertete Partner anzeigen', ja: '未評価のパートナーを表示', ko: '아직 평가되지 않은 파트너 보기' },
  statsRelationshipNone: {
    en: 'No partner relationships rated yet.',
    de: 'Noch keine Partnerbeziehungen bewertet.',
    ja: 'パートナー関係の評価はまだありません。',
    ko: '아직 평가된 파트너 관계가 없습니다.',
  },
  highRiskTitle: { en: 'High-risk programs', de: 'Hochrisiko-Programme', ja: 'ハイリスクプログラム', ko: '고위험 프로그램' },
  highRiskMore: { en: 'More →', de: 'Mehr →', ja: 'さらに表示 →', ko: '더 보기 →' },
  highRiskNone: {
    en: 'Nothing high-risk right now.',
    de: 'Derzeit nichts mit hohem Risiko.',
    ja: '現在ハイリスクの項目はありません。',
    ko: '현재 고위험 항목이 없습니다.',
  },
  lateByWeeks: { en: '≈{n}w late', de: '≈{n} Wo. Verzug', ja: '約{n}週遅れ', ko: '약 {n}주 지연' },
  // Same quantity as the chain's buffer (sopOutlook's days before SOP), so it takes
  // the same word. The German already said "Puffer" while EN said "slack" — one
  // concept was wearing two names, and a reader cannot know they are the same.
  slackWeeks: { en: '≈{n}w buffer', de: '≈{n} Wo. Puffer', ja: '約{n}週のバッファ', ko: '약 {n}주 버퍼' },
  missingSop: { en: 'no SOP target', de: 'kein SOP-Ziel', ja: 'SOP目標なし', ko: 'SOP 목표 없음' },
  // ---- leadership summaries ----
  aiSummary: { en: 'Leadership summary', de: 'Leadership-Zusammenfassung', ja: 'リーダーシップサマリー', ko: '리더십 요약' },
  summaryRisks: { en: 'Risks', de: 'Risiken', ja: 'リスク', ko: '리스크' },
  summaryActions: { en: 'Actions', de: 'Maßnahmen', ja: 'アクション', ko: '조치' },
  summaryProgress: { en: 'Progress', de: 'Fortschritt', ja: '進捗', ko: '진행' },
  summaryThemes: { en: 'Themes', de: 'Themen', ja: 'テーマ', ko: '테마' },
  summariesOffPrefix: {
    en: 'AI summaries are off — no Gemini API key is configured. Set',
    de: 'KI-Zusammenfassungen sind aus — kein Gemini-API-Schlüssel konfiguriert. Setze',
    ja: 'AIサマリーは無効です — Gemini APIキーが未設定です。',
    ko: 'AI 요약이 꺼져 있습니다 — Gemini API 키가 설정되지 않았습니다.',
  },
  summariesOffSuffix: {
    en: 'to enable structured summaries synthesized from ingested and native content.',
    de: ', um strukturierte Zusammenfassungen aus erfassten und nativen Inhalten zu aktivieren.',
    ja: 'を設定すると、取り込み・ネイティブコンテンツからの構造化サマリーが有効になります。',
    ko: '를 설정하면 수집·네이티브 콘텐츠 기반 구조화 요약이 활성화됩니다.',
  },
  summaryEmpty: {
    en: 'No summary yet — generate one from the stored evidence.',
    de: 'Noch keine Zusammenfassung — aus den gespeicherten Belegen erzeugen.',
    ja: 'サマリーはまだありません。保存済みのエビデンスから生成してください。',
    ko: '아직 요약이 없습니다. 저장된 근거로 생성하세요.',
  },
  summaryProvenance: {
    en: 'Generated {d} UTC from {n} sources',
    de: 'Erzeugt {d} UTC aus {n} Quellen',
    ja: '{d} UTCに{n}件のソースから生成',
    ko: '{d} UTC에 {n}개 소스로 생성',
  },
  summaryUpdating: { en: 'Updating…', de: 'Aktualisiert…', ja: '更新中…', ko: '업데이트 중…' },
  summaryRefresh: { en: 'Refresh', de: 'Aktualisieren', ja: '更新', ko: '새로 고침' },
  summaryGenerate: { en: 'Generate summary', de: 'Zusammenfassung erzeugen', ja: 'サマリーを生成', ko: '요약 생성' },
  summarySynthesizing: { en: 'Synthesizing…', de: 'Synthetisiert…', ja: '生成中…', ko: '생성 중…' },
  // The client-side half of a failed refresh: the ANSWER never came back, so there is no
  // server sentence to render. It says only that, because that is all the client knows —
  // the request may well have arrived and died there. Deliberately not a copy of the
  // action's own failure message (app/actions/summaries), which describes a different
  // fact; one sentence per fact, or the two drift into contradicting each other.
  // (That action's messages, like quickIngestAction's, are knowingly untranslated: they
  //  are composed server-side, where there is no locale.)
  summaryRefreshNoAnswer: {
    en: 'The briefing could not be refreshed — the server did not answer.',
    de: 'Das Briefing konnte nicht aktualisiert werden — der Server hat nicht geantwortet.',
    ja: 'ブリーフィングを更新できませんでした。サーバーから応答がありませんでした。',
    ko: '브리핑을 새로 고치지 못했습니다 — 서버가 응답하지 않았습니다.',
  },
  summaryNoEvidence: {
    en: 'Nothing to summarize yet — no stored updates or ingested context for this scope.',
    de: 'Noch nichts zusammenzufassen — keine gespeicherten Updates oder Kontextquellen für diesen Bereich.',
    ja: '要約する情報がまだありません。このスコープには保存された更新や取り込み済みのコンテキストがありません。',
    ko: '아직 요약할 내용이 없습니다 — 이 범위에 저장된 업데이트나 수집된 컨텍스트가 없습니다.',
  },
  managePromptsDesc: {
    en: 'Read and tune the Gemini prompts behind the leadership summaries.',
    de: 'Die Gemini-Prompts hinter den Leadership-Zusammenfassungen lesen und anpassen.',
    ja: 'リーダーシップサマリーのGeminiプロンプトを確認・調整。',
    ko: '리더십 요약의 Gemini 프롬프트를 확인하고 조정.',
  },
  promptsTitle: { en: 'Summary prompts', de: 'Zusammenfassungs-Prompts', ja: 'サマリープロンプト', ko: '요약 프롬프트' },
  promptsIntro: {
    en: 'One prompt per scope. Saving stores an override in the database; clearing a field (or saving it unchanged from the default) reverts to the default, which lives readably in src/lib/summaryPrompts.ts. Keep the evidence-citation contract described there.',
    de: 'Ein Prompt pro Bereich. Speichern legt ein Override in der Datenbank ab; ein geleertes Feld fällt auf den Standard zurück (lesbar in src/lib/summaryPrompts.ts). Den dort beschriebenen Evidenz-Zitations-Vertrag beibehalten.',
    ja: 'スコープごとに1つのプロンプト。保存するとデータベースにオーバーライドが保存され、空にするとデフォルト（src/lib/summaryPrompts.ts に記載）に戻ります。記載のエビデンス引用契約を守ってください。',
    ko: '범위별 프롬프트 1개. 저장 시 DB 오버라이드로 저장되며, 비우면 기본값(src/lib/summaryPrompts.ts)으로 복원됩니다. 문서화된 근거 인용 계약을 유지하세요.',
  },
  promptCustom: { en: 'custom (database override)', de: 'angepasst (Datenbank-Override)', ja: 'カスタム（DBオーバーライド）', ko: '사용자 지정 (DB 오버라이드)' },
  promptDefault: { en: 'default', de: 'Standard', ja: 'デフォルト', ko: '기본값' },
  savePrompt: { en: 'Save prompt', de: 'Prompt speichern', ja: 'プロンプトを保存', ko: '프롬프트 저장' },
  restoreDefaultPrompt: { en: 'Restore default', de: 'Standard wiederherstellen', ja: 'デフォルトに戻す', ko: '기본값 복원' },
  navManage: { en: 'Manage', de: 'Verwalten', ja: '管理', ko: '관리' },
  themeLabel: { en: 'Theme', de: 'Design', ja: 'テーマ', ko: '테마' },
  styleLabel: { en: 'Style', de: 'Stil', ja: 'スタイル', ko: '스타일' },
  styleStandard: { en: 'Standard', de: 'Standard', ja: 'スタンダード', ko: '스탠다드' },
  styleInstrument: { en: 'Instrument', de: 'Instrument', ja: 'インストゥルメント', ko: '인스트루먼트' },
  progressZone: { en: 'Progress', de: 'Fortschritt', ja: '進捗', ko: '진행' },
  aboutZone: { en: 'About this phase', de: 'Über diese Phase', ja: 'このフェーズについて', ko: '이 단계 정보' },
  goalDodPlaceholder: { en: 'Goal: what this phase achieves…\n\nDefinition of done:\n- …', de: 'Ziel: …\n\nDefinition of done:\n- …', ja: 'ゴール: …\n\n完了の定義:\n- …', ko: '목표: …\n\n완료 정의:\n- …' },
  workStartedOn: {
    en: 'Work started on',
    de: 'Arbeit begonnen am',
    ja: '作業開始日',
    ko: '작업 시작일',
  },
  themeLight: { en: 'Light', de: 'Hell', ja: 'ライト', ko: '라이트' },
  themeDark: { en: 'Dark', de: 'Dunkel', ja: 'ダーク', ko: '다크' },
  themeSystem: { en: 'System', de: 'System', ja: 'システム', ko: '시스템' },
  manageIntro: {
    en: 'Authoring and administration — everything that shapes AutoKnow but is not day-to-day program reading.',
    de: 'Autoren- und Verwaltungsbereiche — alles, was AutoKnow formt, aber nicht zur täglichen Programmlektüre gehört.',
    ja: '作成・管理系のページ — AutoKnowを形作るが日々のプログラム閲覧ではないもの。',
    ko: '작성 및 관리 — AutoKnow를 구성하지만 일상적인 프로그램 열람은 아닌 항목들.',
  },
  settingsLanguage: { en: 'Language', de: 'Sprache', ja: '言語', ko: '언어' },
  resetPreferences: { en: 'Reset to defaults', de: 'Auf Standard zurücksetzen', ja: 'デフォルトに戻す', ko: '기본값으로 재설정' },
  settingsLanguageDesc: {
    en: 'The display language for the whole app (stored as a cookie).',
    de: 'Die Anzeigesprache für die gesamte App (als Cookie gespeichert).',
    ja: 'アプリ全体の表示言語（Cookieに保存されます）。',
    ko: '앱 전체의 표시 언어(쿠키로 저장됩니다).',
  },
  manageTemplatesDesc: {
    en: 'Author program phase templates on the card-DAG editor; clone built-ins.',
    de: 'Programmphasen-Vorlagen im Karten-DAG-Editor erstellen; Built-ins klonen.',
    ja: 'カードDAGエディタでフェーズテンプレートを作成。ビルトインの複製も。',
    ko: '카드 DAG 편집기에서 단계 템플릿 작성, 기본 제공 템플릿 복제.',
  },
  manageAdminDesc: {
    en: 'Seeding, reindexing, and other developer controls.',
    de: 'Seeding, Reindexierung und weitere Entwickler-Steuerungen.',
    ja: 'シード投入・再インデックスなどの開発者向け操作。',
    ko: '시드 데이터, 재색인 등 개발자 제어 기능.',
  },
  allPartnersInvolved: {
    en: 'every partner is already involved',
    de: 'alle Partner sind bereits beteiligt',
    ja: '登録済みのパートナーはすべて参加済みです',
    ko: '등록된 모든 파트너가 이미 참여 중입니다',
  },

  // ---- phase card: the compact problem line (constraint + resource strain) ----
  constraintGates: {
    en: 'gates ≈{n} days of downstream chain work',
    de: 'blockiert ≈{n} Tage nachgelagerte Kettenarbeit',
    ja: '下流のチェーン作業 約{n}日分を左右',
    ko: '하류 체인 작업 약 {n}일을 좌우',
  },
  constraintStretched: {
    en: 'stretched: {items}',
    de: 'überlastet: {items}',
    ja: 'リソース逼迫: {items}',
    ko: '리소스 부족: {items}',
  },
  // ---- shared: health display (stored values — en MUST equal the stored string) ----
  healthOnTrack: { en: 'On Track', de: 'Im Plan', ja: '順調', ko: '정상' },
  healthSomeRisk: { en: 'Some Risk', de: 'Etwas Risiko', ja: 'ややリスク', ko: '다소 위험' },
  healthConcerned: { en: 'Concerned', de: 'Besorgt', ja: '懸念あり', ko: '우려' },

  // ---- partner relationship scale (1..7, colorless — see lib/relationship.ts) ----
  relScore1: { en: 'Critical', de: 'Kritisch', ja: '危機的', ko: '위기' },
  relScore2: { en: 'Strained', de: 'Angespannt', ja: '緊張', ko: '긴장' },
  relScore3: { en: 'Steady', de: 'Stabil', ja: '安定', ko: '안정' },
  relScore4: { en: 'Strong', de: 'Stark', ja: '強固', ko: '강력' },
  relScore5: { en: 'Exemplary', de: 'Vorbildlich', ja: '模範的', ko: '모범적' },
  relationshipLabel: { en: 'Relationship', de: 'Beziehung', ja: '関係', ko: '관계' },
  relScaleHint: { en: '1 = critical · 5 = exemplary', de: '1 = kritisch · 5 = vorbildlich', ja: '1 = 危機的 · 5 = 模範的', ko: '1 = 위기 · 5 = 모범적' },
  relScoreAria: { en: 'Relationship score, 1 to 5', de: 'Beziehungswert, 1 bis 5', ja: '関係スコア（1〜5）', ko: '관계 점수, 1~5' },
  relNotRated: { en: 'Not rated', de: 'Nicht bewertet', ja: '未評価', ko: '평가 없음' },
  relNotePlaceholder: { en: 'e.g. Exec sponsor changed; weekly syncs re-established.', de: 'z. B. Sponsorwechsel; wöchentliche Syncs wieder etabliert.', ja: '例: 役員スポンサーが交代。週次同期を再開。', ko: '예: 임원 스폰서 변경, 주간 동기화 재개.' },

  // ---- quick ingest + source freshness ----
  addLink: { en: '+ Watch a source', de: '+ Quelle beobachten', ja: '+ ソースを監視', ko: '+ 소스 감시' },
  qiPlaceholder: { en: 'Paste a link — Doc, bug, CR, web page…', de: 'Link einfügen — Doc, Bug, CR, Webseite…', ja: 'リンクを貼り付け — Doc、バグ、CR、ウェブページ…', ko: '링크 붙여넣기 — 문서, 버그, CR, 웹페이지…' },
  chipWatched: { en: 'Watched', de: 'Beobachtet', ja: '監視中', ko: '감시 중' },
  chipSnapshot: { en: 'Snapshot', de: 'Momentaufnahme', ja: 'スナップショット', ko: '스냅샷' },
  kindDrive: { en: 'Google Doc', de: 'Google-Dokument', ja: 'Google ドキュメント', ko: 'Google 문서' },
  kindChat: { en: 'chat message', de: 'Chat-Nachricht', ja: 'チャットメッセージ', ko: '채팅 메시지' },
  kindTracker: { en: 'bug / change', de: 'Bug / Änderung', ja: 'バグ / 変更', ko: '버그 / 변경' },
  kindWeb: { en: 'web page', de: 'Webseite', ja: 'ウェブページ', ko: '웹페이지' },
  qiSaved: { en: 'Saved — {t}', de: 'Gespeichert — {t}', ja: '保存済み — {t}', ko: '저장됨 — {t}' },
  qiAttached: { en: 'linked to {n}', de: 'verknüpft mit {n}', ja: '{n} に関連付け', ko: '{n}에 연결됨' },
  qiDuplicate: { en: 'Already watching — this link is in the system.', de: 'Wird bereits beobachtet — dieser Link ist im System.', ja: '既に監視中 — このリンクは登録されています。', ko: '이미 감시 중 — 이 링크는 시스템에 있습니다.' },
  frozenLabel: { en: 'frozen — {r}', de: 'eingefroren — {r}', ja: '凍結 — {r}', ko: '동결 — {r}' },
  frzResolved: { en: 'resolved', de: 'gelöst', ja: '解決済み', ko: '해결됨' },
  frzAccess: { en: 'access revoked', de: 'Zugriff entzogen', ja: 'アクセス取消', ko: '접근 취소됨' },
  frzDeleted: { en: 'deleted', de: 'gelöscht', ja: '削除済み', ko: '삭제됨' },
  frzAuth: { en: 'sign-in required', de: 'Anmeldung erforderlich', ja: 'ログインが必要', ko: '로그인 필요' },
  frzPaused: { en: 'paused', de: 'pausiert', ja: '一時停止', ko: '일시중지' },
  refreshNow: { en: 'Refresh now', de: 'Jetzt aktualisieren', ja: '今すぐ更新', ko: '지금 새로고침' },
  pauseLabel: { en: 'Pause', de: 'Pausieren', ja: '一時停止', ko: '일시중지' },
  resumeLabel: { en: 'Resume', de: 'Fortsetzen', ja: '再開', ko: '재개' },
  sourcesTitle: { en: 'Sources', de: 'Quellen', ja: 'ソース', ko: '소스' },
  sourcesIntro: {
    en: 'Everything AutoKnow has ingested and how it stays fresh. Watched sources are re-checked on their connector’s cadence; snapshots never are.',
    de: 'Alles, was AutoKnow erfasst hat, und wie es aktuell bleibt. Beobachtete Quellen werden im Takt ihres Konnektors geprüft; Momentaufnahmen nie.',
    ja: 'AutoKnow が取り込んだすべてのソースと、その鮮度の保ち方。監視中のソースはコネクタの周期で再確認され、スナップショットは再確認されません。',
    ko: 'AutoKnow가 수집한 모든 소스와 최신 상태 유지 방식. 감시 중인 소스는 커넥터 주기에 따라 재확인되며 스냅샷은 재확인되지 않습니다.',
  },
  sourcesDriveOn: {
    // No cadence claim: the schedule lives in Cloud Scheduler (`cron_schedule`) and is
    // never handed to the app, so "within the hour" was prose asserting infra the app
    // cannot see — false on every deployment with a different schedule, and on the
    // local/self-hosted ones with no scheduler at all.
    en: 'Drive sync is on — share a Doc or folder with {email} and the refresh worker will index it on its next run.',
    de: 'Drive-Sync ist aktiv — teilen Sie ein Dokument oder einen Ordner mit {email}; der Refresh-Worker indexiert es bei seinem nächsten Lauf.',
    ja: 'Drive 同期は有効です — {email} にドキュメントやフォルダを共有すると、次回のリフレッシュ実行時にインデックスされます。',
    ko: 'Drive 동기화가 켜져 있습니다 — {email}과 문서나 폴더를 공유하면 새로고침 작업자가 다음 실행 때 색인합니다.',
  },
  // No Workspace share group is configured (no GOOGLE_SHARE_ADDRESS): name the service
  // account as itself. Sharing with it directly works; calling it "the address to share
  // with" would claim a friendly address this deployment does not have.
  sourcesDriveOnDirect: {
    en: 'Drive sync is on — no Workspace share address is configured, so share a Doc or folder directly with the service account {email} and the refresh worker will index it on its next run. Sharing with a service account is external to your domain; your Workspace sharing policy has to allow it.',
    de: 'Drive-Sync ist aktiv — es ist keine Workspace-Freigabeadresse konfiguriert. Teilen Sie ein Dokument oder einen Ordner daher direkt mit dem Servicekonto {email}; der Refresh-Worker indexiert es bei seinem nächsten Lauf. Ein Servicekonto liegt außerhalb Ihrer Domain — Ihre Workspace-Freigaberichtlinie muss das zulassen.',
    ja: 'Drive 同期は有効です — Workspace の共有アドレスが設定されていないため、ドキュメントやフォルダはサービスアカウント {email} に直接共有してください。次回のリフレッシュ実行時にインデックスされます。サービスアカウントはドメイン外のため、Workspace の共有ポリシーで許可されている必要があります。',
    ko: 'Drive 동기화가 켜져 있습니다 — Workspace 공유 주소가 구성되어 있지 않으므로 문서나 폴더를 서비스 계정 {email}과 직접 공유하세요. 새로고침 작업자가 다음 실행 때 색인합니다. 서비스 계정은 도메인 외부이므로 Workspace 공유 정책에서 허용해야 합니다.',
  },
  sourcesDriveOff: {
    en: 'Background refresh of Google Docs starts once the service account is configured; until then use Refresh now while signed in.',
    de: 'Die Hintergrund-Aktualisierung von Google Docs startet, sobald das Servicekonto konfiguriert ist; bis dahin „Jetzt aktualisieren“ bei aktiver Anmeldung nutzen.',
    ja: 'Google ドキュメントのバックグラウンド更新はサービスアカウント設定後に開始されます。それまではログイン状態で「今すぐ更新」を使用してください。',
    ko: 'Google 문서의 백그라운드 새로고침은 서비스 계정 구성 후 시작됩니다. 그 전까지는 로그인 상태에서 ‘지금 새로고침’을 사용하세요.',
  },
  // #38 ingestion-health panel
  ingestHealthTitle: { en: 'Ingestion health', de: 'Erfassungsstatus', ja: '取り込みの状態', ko: '수집 상태' },
  ingestStatBacklog: { en: 'Backlog', de: 'Rückstand', ja: '待ち', ko: '대기' },
  ingestStatDiscovered: { en: 'Discovered', de: 'Neu erfasst', ja: '新規', ko: '신규' },
  ingestStatRefreshed: { en: 'Refreshed', de: 'Aktualisiert', ja: '更新', ko: '갱신' },
  ingestStatSkipped: { en: 'Skipped', de: 'Übersprungen', ja: 'スキップ', ko: '건너뜀' },
  ingestStatErrors: { en: 'Errors', de: 'Fehler', ja: 'エラー', ko: '오류' },
  ingestRanAt: { en: 'Last cycle: {when} UTC', de: 'Letzter Lauf: {when} UTC', ja: '前回: {when} UTC', ko: '마지막 실행: {when} UTC' },
  ingestQuotaStopped: {
    en: 'stopped early — free-tier quota reached',
    de: 'vorzeitig gestoppt — Kontingent des kostenlosen Tarifs erreicht',
    ja: '早期停止 — 無料枠の上限に到達',
    ko: '조기 중단 — 무료 등급 한도 도달',
  },
  ingestNeverRun: {
    en: 'The refresh worker hasn’t run yet.',
    de: 'Der Aktualisierungs-Worker wurde noch nicht ausgeführt.',
    ja: '更新ワーカーはまだ実行されていません。',
    ko: '새로고침 작업이 아직 실행되지 않았습니다.',
  },
  ingestBudgetTitle: { en: 'Free-tier budget', de: 'Budget (kostenloser Tarif)', ja: '無料枠の予算', ko: '무료 등급 예산' },
  ingestBudgetHelp: {
    en: 'The daily Gemini allowance for automatic work, set as documents per day. Each document costs about 2 calls; unchanged documents cost nothing. Summaries draw on the same allowance, after ingestion — so a quiet day spends it keeping summaries current. Searching and regenerating by hand cost extra. Raise it to fill a new corpus faster (watch the free-tier line), or lower it to stay well clear.',
    de: 'Das tägliche Gemini-Kontingent für automatische Arbeit, angegeben als Dokumente pro Tag. Jedes Dokument kostet etwa 2 Aufrufe; unveränderte Dokumente kosten nichts. Zusammenfassungen werden nach der Erfassung aus demselben Kontingent bezahlt — an einem ruhigen Tag hält es also die Zusammenfassungen aktuell. Suchen und manuelles Neuerzeugen kosten zusätzlich. Höher, um einen neuen Bestand schneller zu füllen (die Freigrenze beachten), oder niedriger, um deutlich darunter zu bleiben.',
    ja: '自動処理に使う 1 日分の Gemini 利用枠を、ドキュメント数として設定します。1 件あたり約 2 回の呼び出しが必要で、変更のないドキュメントは消費しません。要約も取り込みの後に同じ枠から使われるため、変更の少ない日はこの枠が要約の更新に充てられます。検索と手動での再生成は別途消費します。新しいコーパスを速く埋めるには上げ（無料枠の線に注意）、余裕を持たせるには下げます。',
    ko: '자동 처리에 쓰는 하루치 Gemini 사용량을 문서 수로 설정합니다. 문서당 약 2회의 호출이 필요하며 변경되지 않은 문서는 소비하지 않습니다. 요약도 수집 이후 같은 사용량에서 차감되므로, 변경이 적은 날에는 이 사용량이 요약을 최신으로 유지하는 데 쓰입니다. 검색과 수동 재생성은 별도로 소비합니다. 새 코퍼스를 빨리 채우려면 올리고(무료 등급 선 확인), 여유를 두려면 내리세요.',
  },
  ingestBudgetSliderLabel: { en: 'Daily re-ingest budget', de: 'Tägliches Erfassungsbudget', ja: '1 日の取り込み予算', ko: '일일 수집 예산' },
  ingestBudgetDocsUnit: { en: 'docs/day', de: 'Dok./Tag', ja: '件/日', ko: '건/일' },
  ingestBudgetRequestsUnit: { en: 'Gemini requests/day', de: 'Gemini-Anfragen/Tag', ja: 'Gemini リクエスト/日', ko: 'Gemini 요청/일' },
  ingestBudgetFreeTierMarker: { en: 'free tier', de: 'Freigrenze', ja: '無料枠', ko: '무료 등급' },
  ingestBudgetSafe: { en: 'under the free tier', de: 'unter der Freigrenze', ja: '無料枠内', ko: '무료 등급 이내' },
  ingestBudgetOver: {
    en: 'over the free tier — extra requests are refused (429)',
    de: 'über der Freigrenze — zusätzliche Anfragen werden abgelehnt (429)',
    ja: '無料枠超過 — 超過分のリクエストは拒否されます (429)',
    ko: '무료 등급 초과 — 초과 요청은 거부됩니다 (429)',
  },
  ingestBudgetFreeTierLabel: {
    en: 'Free-tier limit (requests/day):',
    de: 'Freigrenze (Anfragen/Tag):',
    ja: '無料枠の上限（リクエスト/日）:',
    ko: '무료 등급 한도(요청/일):',
  },
  ingestBudgetSave: { en: 'Save budget', de: 'Budget speichern', ja: '予算を保存', ko: '예산 저장' },
  ingestBudgetSaving: { en: 'Saving…', de: 'Speichern…', ja: '保存中…', ko: '저장 중…' },
  ingestBudgetSaved: { en: 'Saved ✓', de: 'Gespeichert ✓', ja: '保存しました ✓', ko: '저장됨 ✓' },
  ingestBudgetVerify: {
    en: 'Verify your free-tier limit at ai.google.dev/gemini-api/docs/rate-limits — Google changes it, and it depends on your model and tier.',
    de: 'Prüfen Sie Ihre Freigrenze unter ai.google.dev/gemini-api/docs/rate-limits — Google ändert sie, und sie hängt von Modell und Tarif ab.',
    ja: '無料枠の上限は ai.google.dev/gemini-api/docs/rate-limits で確認してください。Google が変更することがあり、モデルとティアによって異なります。',
    ko: '무료 등급 한도는 ai.google.dev/gemini-api/docs/rate-limits에서 확인하세요. Google이 변경하며 모델과 등급에 따라 다릅니다.',
  },
  ingestLimitsTitle: {
    en: 'What gets indexed — and what doesn’t',
    de: 'Was indexiert wird — und was nicht',
    ja: 'インデックスされるもの — されないもの',
    ko: '색인되는 것 — 그리고 아닌 것',
  },
  ingestLimitDocs: {
    en: 'Only Google Docs are indexed. Shared Sheets, Slides and PDFs appear below as “not indexed”, never silently dropped.',
    de: 'Nur Google Docs werden indexiert. Geteilte Sheets, Slides und PDFs erscheinen unten als „nicht indexiert“ und werden nie stillschweigend verworfen.',
    ja: 'インデックス対象は Google ドキュメントのみです。共有された Sheets、Slides、PDF は下に「未インデックス」として表示され、黙って破棄されることはありません。',
    ko: 'Google 문서만 색인됩니다. 공유된 Sheets, Slides, PDF는 아래에 “색인 안 됨”으로 표시되며 조용히 버려지지 않습니다.',
  },
  ingestLimitChars: {
    en: 'Only the first ~{chars} characters (about 10 pages) of a document are read. For rolling meeting notes, keep the freshest content at the top.',
    de: 'Nur die ersten ~{chars} Zeichen (etwa 10 Seiten) eines Dokuments werden gelesen. Bei fortlaufenden Besprechungsnotizen den neuesten Inhalt oben halten.',
    ja: 'ドキュメントは先頭の約 {chars} 文字（およそ 10 ページ）のみが読み取られます。継続的な議事録では、最新の内容を先頭に置いてください。',
    ko: '문서는 처음 약 {chars}자(약 10페이지)만 읽습니다. 계속 이어지는 회의록은 최신 내용을 맨 위에 두세요.',
  },
  ingestLimitDepth: {
    en: 'Shared folders are followed {depth} levels deep; anything deeper is listed below as “not indexed”.',
    de: 'Geteilte Ordner werden {depth} Ebenen tief verfolgt; alles Tiefere erscheint unten als „nicht indexiert“.',
    ja: '共有フォルダは {depth} 階層まで辿ります。それより深いものは下に「未インデックス」として表示されます。',
    ko: '공유 폴더는 {depth}단계까지 따라갑니다. 그보다 깊은 것은 아래에 “색인 안 됨”으로 표시됩니다.',
  },
  // Two branches, because the cadence is infrastructure's to state. This one runs when
  // REFRESH_CRON_SCHEDULE is absent or unparseable: it describes the behaviour without
  // naming a frequency, where "hourly" used to assert a schedule that is true on one
  // deployment and false on every local checkout, which has no scheduler at all.
  ingestLimitCadence: {
    en: 'Sources are re-checked on each refresh run, within the daily budget above — a busy day can lag by a few runs before it catches up.',
    de: 'Quellen werden bei jedem Refresh-Lauf erneut geprüft, im Rahmen des obigen Tagesbudgets — an einem geschäftigen Tag kann es einige Läufe dauern, bis der Rückstand aufgeholt ist.',
    ja: 'ソースは上記の 1 日の予算の範囲で、リフレッシュ実行のたびに再確認されます。多忙な日は追いつくまで数回の実行を要することがあります。',
    ko: '소스는 위의 일일 예산 범위 내에서 새로고침이 실행될 때마다 재확인됩니다. 바쁜 날에는 따라잡기까지 몇 번의 실행이 걸릴 수 있습니다.',
  },
  // And this one when Terraform did export the Scheduler cadence — the same number the
  // budget math divides by, so the sentence and the gauge above it cannot disagree.
  ingestLimitCadenceKnown: {
    en: 'Sources are re-checked {cycles} times a day, within the daily budget above — a busy day can lag by a few runs before it catches up.',
    de: 'Quellen werden {cycles}-mal täglich erneut geprüft, im Rahmen des obigen Tagesbudgets — an einem geschäftigen Tag kann es einige Läufe dauern, bis der Rückstand aufgeholt ist.',
    ja: 'ソースは上記の 1 日の予算の範囲で、1 日に {cycles} 回再確認されます。多忙な日は追いつくまで数回の実行を要することがあります。',
    ko: '소스는 위의 일일 예산 범위 내에서 하루 {cycles}회 재확인됩니다. 바쁜 날에는 따라잡기까지 몇 번의 실행이 걸릴 수 있습니다.',
  },
  ingestSkipsTitle: {
    en: 'Shared but not indexed ({count})',
    de: 'Geteilt, aber nicht indexiert ({count})',
    ja: '共有済みだが未インデックス ({count})',
    ko: '공유됐으나 색인 안 됨 ({count})',
  },
  ingestSkipsEmpty: {
    en: 'Everything shared with the app is a supported type within the followed depth.',
    de: 'Alles mit der App Geteilte ist ein unterstützter Typ innerhalb der verfolgten Tiefe.',
    ja: 'アプリに共有されたものはすべて、辿る深さの範囲内でサポート対象の種類です。',
    ko: '앱에 공유된 모든 항목이 따라가는 깊이 내의 지원 형식입니다.',
  },
  ingestSkipReasonType: { en: 'unsupported type', de: 'nicht unterstützter Typ', ja: '非対応の種類', ko: '지원되지 않는 형식' },
  ingestSkipReasonDepth: { en: 'in a folder too deep', de: 'in einem zu tiefen Ordner', ja: '深すぎるフォルダ内', ko: '너무 깊은 폴더에 있음' },
  // #56 — the boundary limits, said out loud where the user meets them.
  ingestLimitTruncatedNow: {
    en: '{count} indexed sources are longer than that and were cut off — each is marked “truncated” in the table below.',
    de: '{count} indexierte Quellen sind länger und wurden abgeschnitten — jede ist in der Tabelle unten als „gekürzt“ markiert.',
    ja: 'インデックス済みのソースのうち {count} 件はこれより長く、途中で打ち切られました。下の表でそれぞれ「切り詰め」と表示されます。',
    ko: '색인된 소스 중 {count}개는 이보다 길어 잘렸습니다. 아래 표에서 각각 “잘림”으로 표시됩니다.',
  },
  sourceTruncated: { en: 'truncated', de: 'gekürzt', ja: '切り詰め', ko: '잘림' },
  sourceTruncatedTitle: {
    en: 'Lossy: only the first {chars} characters of this source were distilled and indexed — anything after that is not searchable.',
    de: 'Verlustbehaftet: Nur die ersten {chars} Zeichen dieser Quelle wurden destilliert und indexiert — alles danach ist nicht durchsuchbar.',
    ja: '欠落あり: このソースは先頭 {chars} 文字のみが要約・インデックスされています。それ以降は検索できません。',
    ko: '손실 있음: 이 소스는 처음 {chars}자만 요약·색인되었습니다. 그 이후 내용은 검색되지 않습니다.',
  },
  ingestRejectMedia: {
    en: 'That file isn’t indexable ({type}). AutoKnow reads text — Google Docs, web pages and pasted notes — so video, images, audio and other binaries are never downloaded.',
    de: 'Diese Datei ist nicht indexierbar ({type}). AutoKnow liest Text — Google Docs, Webseiten und eingefügte Notizen —, daher werden Video, Bilder, Audio und andere Binärdateien nie heruntergeladen.',
    ja: 'このファイルはインデックスできません（{type}）。AutoKnow が読むのはテキスト（Google ドキュメント、ウェブページ、貼り付けたメモ）だけで、動画・画像・音声などのバイナリはダウンロードしません。',
    ko: '이 파일은 색인할 수 없습니다({type}). AutoKnow는 텍스트(Google 문서, 웹페이지, 붙여넣은 메모)만 읽으므로 동영상·이미지·오디오 등 바이너리는 내려받지 않습니다.',
  },
  // #56 — Google Chat ack copy. It says THREAD, first-N, SNAPSHOT; never "room", never
  // "watched" (docs/SCALING_LIMITS.md §3 — this connector reads one thread, once).
  chatAddedToSpace: {
    en: 'AutoKnow is here. @mention me on any message and I’ll save that thread — a snapshot of its first {n} messages — as program or partner context. I don’t watch this space: nothing is read until you mention me.',
    de: 'AutoKnow ist da. Erwähne mich (@) in einer Nachricht, und ich sichere diesen Thread — eine Momentaufnahme seiner ersten {n} Nachrichten — als Programm- oder Partnerkontext. Ich beobachte diesen Space nicht: Ohne Erwähnung wird nichts gelesen.',
    ja: 'AutoKnow が参加しました。メッセージで @ メンションすると、そのスレッド（先頭 {n} 件のメッセージのスナップショット）をプログラムまたはパートナーの文脈として保存します。このスペースは監視しません。メンションされるまで何も読みません。',
    ko: 'AutoKnow가 참여했습니다. 메시지에서 @멘션하면 해당 스레드(처음 {n}개 메시지의 스냅샷)를 프로그램 또는 파트너 컨텍스트로 저장합니다. 이 스페이스를 감시하지는 않으며, 멘션하기 전에는 아무것도 읽지 않습니다.',
  },
  chatAiOff: {
    en: 'AI ingestion is off (no GEMINI_API_KEY on the server) — nothing was saved.',
    de: 'Die KI-Erfassung ist aus (kein GEMINI_API_KEY auf dem Server) — es wurde nichts gespeichert.',
    ja: 'AI 取り込みは無効です（サーバーに GEMINI_API_KEY がありません）— 何も保存されていません。',
    ko: 'AI 수집이 꺼져 있습니다(서버에 GEMINI_API_KEY 없음) — 아무것도 저장되지 않았습니다.',
  },
  chatDomainOnly: {
    en: 'AutoKnow only ingests messages from @{domain} accounts.',
    de: 'AutoKnow erfasst nur Nachrichten von @{domain}-Konten.',
    ja: 'AutoKnow は @{domain} アカウントのメッセージのみ取り込みます。',
    ko: 'AutoKnow는 @{domain} 계정의 메시지만 수집합니다.',
  },
  chatNoText: {
    en: 'I couldn’t read any text to save (is space history on?).',
    de: 'Ich konnte keinen Text zum Speichern lesen (ist der Verlauf des Space aktiviert?).',
    ja: '保存できるテキストを読み取れませんでした（スペースの履歴は有効ですか）。',
    ko: '저장할 텍스트를 읽지 못했습니다(스페이스 기록이 켜져 있나요?).',
  },
  chatSaved: {
    en: 'Saved. It will appear in the activity feed and leadership summaries.',
    de: 'Gespeichert. Es erscheint im Aktivitätsverlauf und in den Leitungs-Zusammenfassungen.',
    ja: '保存しました。アクティビティフィードと経営向けサマリーに表示されます。',
    ko: '저장했습니다. 활동 피드와 리더십 요약에 표시됩니다.',
  },
  chatSavedLinked: {
    en: 'Saved — linked to {name}. It will appear in the activity feed and leadership summaries.',
    de: 'Gespeichert — verknüpft mit {name}. Es erscheint im Aktivitätsverlauf und in den Leitungs-Zusammenfassungen.',
    ja: '保存しました — {name} に紐づけました。アクティビティフィードと経営向けサマリーに表示されます。',
    ko: '저장했습니다 — {name}에 연결했습니다. 활동 피드와 리더십 요약에 표시됩니다.',
  },
  chatSnapshotNote: {
    en: 'This is a snapshot of this one thread as of now, not a watch on the space — @mention me again to update it.',
    de: 'Das ist eine Momentaufnahme genau dieses Threads zum jetzigen Stand, keine Beobachtung des Space — erwähne mich erneut (@), um sie zu aktualisieren.',
    ja: 'これはこのスレッド 1 件の現時点のスナップショットであり、スペースの監視ではありません。更新するには再度 @ メンションしてください。',
    ko: '이것은 이 스레드 하나의 현재 시점 스냅샷이며 스페이스 감시가 아닙니다. 업데이트하려면 다시 @멘션하세요.',
  },
  chatThreadCapped: {
    en: 'The thread is longer than {n} messages, so only its first {n} were read.',
    de: 'Der Thread hat mehr als {n} Nachrichten, daher wurden nur die ersten {n} gelesen.',
    ja: 'このスレッドは {n} 件を超えるため、先頭の {n} 件のみ読み取りました。',
    ko: '이 스레드는 {n}개를 넘어서 처음 {n}개만 읽었습니다.',
  },
  chatThreadUnreadable: {
    en: 'I couldn’t read the thread’s earlier messages, so only your message was saved.',
    de: 'Ich konnte die früheren Nachrichten des Threads nicht lesen, daher wurde nur deine Nachricht gespeichert.',
    ja: 'スレッドの以前のメッセージを読み取れなかったため、あなたのメッセージのみを保存しました。',
    ko: '스레드의 이전 메시지를 읽지 못해 회원님의 메시지만 저장했습니다.',
  },
  chatUnchanged: {
    en: 'Already saved — nothing new in this thread since the last snapshot.',
    de: 'Bereits gespeichert — seit der letzten Momentaufnahme nichts Neues in diesem Thread.',
    ja: '保存済みです — 前回のスナップショット以降、このスレッドに新しい内容はありません。',
    ko: '이미 저장되어 있습니다 — 마지막 스냅샷 이후 이 스레드에 새로운 내용이 없습니다.',
  },
  chatUpdated: {
    en: 'Updated — saved what’s new in this thread.',
    de: 'Aktualisiert — das Neue in diesem Thread wurde gespeichert.',
    ja: '更新しました — このスレッドの新しい内容を保存しました。',
    ko: '업데이트했습니다 — 이 스레드의 새로운 내용을 저장했습니다.',
  },
  chatSaveFailed: {
    en: 'Could not save this thread: {reason}',
    de: 'Dieser Thread konnte nicht gespeichert werden: {reason}',
    ja: 'このスレッドを保存できませんでした: {reason}',
    ko: '이 스레드를 저장하지 못했습니다: {reason}',
  },
  sourceUpdated: { en: 'Updated: {t}', de: 'Aktualisiert: {t}', ja: '更新: {t}', ko: '업데이트: {t}' },
  colSource: { en: 'Source', de: 'Quelle', ja: 'ソース', ko: '소스' },
  colKind: { en: 'Kind', de: 'Art', ja: '種類', ko: '종류' },
  colTracking: { en: 'Watch', de: 'Beobachtung', ja: '監視', ko: '감시' },
  colAddedBy: { en: 'Added by', de: 'Hinzugefügt von', ja: '追加者', ko: '추가한 사람' },
  colLastChecked: { en: 'Last checked', de: 'Zuletzt geprüft', ja: '最終確認', ko: '마지막 확인' },
  colRevisions: { en: 'Rev', de: 'Rev', ja: '版', ko: '개정' },
  stateFrozen: { en: 'Frozen', de: 'Eingefroren', ja: '凍結', ko: '동결' },
  sourcesLegend: {
    en: 'Refresh now — re-fetch immediately; content is re-distilled only if its text actually changed. Pause / Resume — stop or restart automatic checks without losing history. Watched / Snapshot — flips whether the source is checked at all: snapshots are indexed once and never re-fetched.',
    de: 'Jetzt aktualisieren — sofort neu abrufen; neu destilliert wird nur bei tatsächlich geändertem Text. Pausieren / Fortsetzen — automatische Prüfungen stoppen bzw. neu starten, ohne Verlauf zu verlieren. Beobachtet / Momentaufnahme — schaltet um, ob die Quelle überhaupt geprüft wird: Momentaufnahmen werden einmal indexiert und nie erneut abgerufen.',
    ja: '「今すぐ更新」— 直ちに再取得。テキストが実際に変わった場合のみ再蒸留します。「一時停止 / 再開」— 履歴を失わずに自動チェックを停止・再開。「監視中 / スナップショット」— チェック対象かどうかを切り替え。スナップショットは一度だけインデックスされ、再取得されません。',
    ko: '지금 새로고침 — 즉시 다시 가져오며, 텍스트가 실제로 변경된 경우에만 재증류합니다. 일시중지 / 재개 — 기록을 잃지 않고 자동 확인을 중지·재개합니다. 감시 중 / 스냅샷 — 확인 여부 자체를 전환하며, 스냅샷은 한 번만 색인되고 다시 가져오지 않습니다.',
  },
  neverChecked: { en: 'never', de: 'nie', ja: '未確認', ko: '없음' },
  manageSourcesDesc: {
    en: 'Every ingested source, its watch mode, and its freshness — refresh, pause, or switch between watched and snapshot.',
    de: 'Jede erfasste Quelle, ihr Beobachtungsmodus und ihre Aktualität — aktualisieren, pausieren oder zwischen beobachtet und Momentaufnahme wechseln.',
    ja: '取り込んだ全ソースとその監視モード・鮮度 — 更新・一時停止・監視とスナップショットの切り替えができます。',
    ko: '수집된 모든 소스와 감시 모드, 최신성 — 새로고침, 일시중지, 감시와 스냅샷 전환이 가능합니다.',
  },

  filterColumn: { en: 'Filter {c}', de: '{c} filtern', ja: '{c} を絞り込み', ko: '{c} 필터' },
  clearFilter: { en: 'Clear', de: 'Zurücksetzen', ja: 'クリア', ko: '지우기' },
  clearAllFilters: { en: 'Clear filters', de: 'Filter zurücksetzen', ja: 'フィルターをクリア', ko: '필터 지우기' },
  // Placeholders for the DataTable key-column FILTER box — they read as "filter", never
  // "search": the box narrows loaded rows, it does not query (design.md §6, #86).
  filterListPlaceholder: { en: 'Filter…', de: 'Filtern…', ja: '絞り込み…', ko: '필터…' },
  filterProgramsPlaceholder: { en: 'Filter programs…', de: 'Programme filtern…', ja: 'プログラムを絞り込み…', ko: '프로그램 필터…' },
  filterPartnersPlaceholder: { en: 'Filter partners…', de: 'Partner filtern…', ja: 'パートナーを絞り込み…', ko: '파트너 필터…' },
  filterPeoplePlaceholder: { en: 'Filter people…', de: 'Personen filtern…', ja: '人物を絞り込み…', ko: '사람 필터…' },
  filterSourcesPlaceholder: { en: 'Filter sources…', de: 'Quellen filtern…', ja: 'ソースを絞り込み…', ko: '소스 필터…' },
  moreActions: { en: 'More actions', de: 'Weitere Aktionen', ja: 'その他の操作', ko: '추가 작업' },
  leadPartnerLabel: { en: 'Lead partner (OEM)', de: 'Lead-Partner (OEM)', ja: 'リードパートナー（OEM）', ko: '리드 파트너 (OEM)' },
  // ---- partner CRUD ----
  newPartner: { en: 'New partner', de: 'Neuer Partner', ja: '新規パートナー', ko: '새 파트너' },
  editPartnerTitle: { en: 'Edit partner', de: 'Partner bearbeiten', ja: 'パートナーを編集', ko: '파트너 편집' },
  confirmPartnerDeletion: { en: 'Delete this partner?', de: 'Diesen Partner löschen?', ja: 'このパートナーを削除しますか？', ko: '이 파트너를 삭제하시겠습니까?' },
  permanentlyDeletePartner: { en: 'Permanently delete partner', de: 'Partner endgültig löschen', ja: 'パートナーを完全に削除', ko: '파트너 영구 삭제' },
  typePartnerNameExactly: { en: 'Type the partner name exactly', de: 'Partnernamen exakt eingeben', ja: 'パートナー名を正確に入力', ko: '파트너 이름을 정확히 입력' },
  partnerHasPrograms: {
    en: 'This partner still owns {n} program(s) — reassign or delete them first.',
    de: 'Dieser Partner besitzt noch {n} Programm(e) — zuerst neu zuordnen oder löschen.',
    ja: 'このパートナーはまだ {n} 件のプログラムを所有しています。先に移管または削除してください。',
    ko: '이 파트너는 아직 {n}개의 프로그램을 소유하고 있습니다. 먼저 재할당하거나 삭제하세요.',
  },
  // Counts person RECORDS pointing here, which is what the delete would break — so it can
  // differ from the people table above, and says so rather than leaving the reader to
  // wonder which number is lying (autoknow-aa7, lib/partnerDeletion).
  partnerHasPeople: {
    en: '{n} person record(s) still name this partner as their employer, including anyone whose move has not been recorded — reassign them first.',
    de: '{n} Personendatensatz/-sätze nennen diesen Partner noch als Arbeitgeber, auch Personen, deren Wechsel noch nicht erfasst ist — zuerst neu zuordnen.',
    ja: '{n} 件の担当者レコードがこのパートナーを勤務先として参照しています（異動が未登録の担当者を含む）。先に所属を変更してください。',
    ko: '{n}명의 인물 레코드가 아직 이 파트너를 소속사로 지정하고 있습니다(이동이 기록되지 않은 사람 포함). 먼저 재배정하세요.',
  },
  statusPending: { en: 'Pending', de: 'Offen', ja: '未処理', ko: '대기 중' },
  statusCompleted: { en: 'Completed', de: 'Erledigt', ja: '完了済み', ko: '완료됨' },

  // ---- shared: generic labels ----
  allLabel: { en: 'All', de: 'Alle', ja: 'すべて', ko: '전체' },
  otherLabel: { en: 'Other', de: 'Sonstige', ja: 'その他', ko: '기타' },
  partnerLabel: { en: 'Partner', de: 'Partner', ja: 'パートナー', ko: '파트너' },
  programLabel: { en: 'Program', de: 'Programm', ja: 'プログラム', ko: '프로그램' },
  personLabel: { en: 'Person', de: 'Person', ja: '担当者', ko: '사람' },
  contextLabel: { en: 'Context', de: 'Kontext', ja: 'コンテキスト', ko: '컨텍스트' },
  statusLabel: { en: 'Status', de: 'Status', ja: 'ステータス', ko: '상태' },
  statusActive: { en: 'Active', de: 'Aktiv', ja: 'アクティブ', ko: '활성' },
  statusCancelled: { en: 'Cancelled', de: 'Abgebrochen', ja: '中止', ko: '취소됨' },
  markComplete: { en: 'Mark complete', de: 'Als abgeschlossen markieren', ja: '完了にする', ko: '완료로 표시' },
  markCancelled: { en: 'Mark cancelled', de: 'Als abgebrochen markieren', ja: '中止にする', ko: '취소로 표시' },
  reactivateProgram: { en: 'Reactivate', de: 'Reaktivieren', ja: '再開する', ko: '재활성화' },
  latestUpdate: { en: 'Latest update', de: 'Letztes Update', ja: '最新の更新', ko: '최신 업데이트' },
  phaseLabel: { en: 'Phase', de: 'Phase', ja: 'フェーズ', ko: '단계' },
  ownerLabel: { en: 'Owner', de: 'Verantwortlich', ja: 'オーナー', ko: '담당자' },
  teamLabel: { en: 'Team', de: 'Team', ja: 'チーム', ko: '팀' },
  // ---- partner people: #124 §4's three buckets, as the Status column reads them ----
  // These are the READING form only. The filter's value stays the English token
  // ('current' / 'past' / 'incoming'), so a Status funnel means the same thing in every
  // locale — a locale-stable shareable token, read as a name only in `filterLabel`
  // (design.md §6).
  rosterStatusCurrent: { en: 'Current', de: 'Aktuell', ja: '在籍中', ko: '재직 중' },
  rosterStatusPast: { en: 'Past', de: 'Ehemalig', ja: '在籍終了', ko: '퇴사' },
  rosterStatusIncoming: { en: 'Incoming', de: 'Kommend', ja: '着任予定', ko: '입사 예정' },
  progressLabel: { en: 'Progress', de: 'Fortschritt', ja: '進捗', ko: '진행률' },
  needleLabel: { en: 'Needle', de: 'Nadel', ja: 'ニードル', ko: '니들' },
  searchHeading: { en: 'Search', de: 'Suche', ja: '検索', ko: '검색' },

  // ---- landing page (/) ----
  landingLatest: {
    en: 'Latest updates',
    de: 'Neueste Aktualisierungen',
    ja: '最新の更新',
    ko: '최신 업데이트',
  },
  landingLatestEmpty: {
    en: 'Nothing has been gathered or written yet.',
    de: 'Bisher wurde nichts erfasst oder geschrieben.',
    ja: 'まだ何も収集・記録されていません。',
    ko: '아직 수집되거나 작성된 내용이 없습니다.',
  },
  landingBrowse: {
    en: 'Or go straight to {ecosystem}, {programs}, {partners}, or {people}.',
    de: 'Oder direkt zu {ecosystem}, {programs}, {partners} oder {people}.',
    ja: 'または{ecosystem}・{programs}・{partners}・{people}へ直接移動します。',
    ko: '또는 {ecosystem}, {programs}, {partners}, {people}(으)로 바로 이동하세요.',
  },

  tbd: { en: 'TBD', de: 'Offen', ja: '未定', ko: '미정' },
  notAvailable: { en: 'N/A', de: 'k. A.', ja: '該当なし', ko: '해당 없음' },
  unassigned: { en: 'Unassigned', de: 'Nicht zugewiesen', ja: '未割り当て', ko: '미지정' },
  finishedLabel: { en: 'Finished', de: 'Fertig', ja: '完了', ko: '완료' },
  archived: { en: 'Archived', de: 'Archiviert', ja: 'アーカイブ済み', ko: '보관됨' },
  removeLabel: { en: 'Remove', de: 'Entfernen', ja: '削除', ko: '제거' },
  clone: { en: 'Clone', de: 'Duplizieren', ja: '複製', ko: '복제' },
  deleteLabel: { en: 'Delete', de: 'Löschen', ja: '削除', ko: '삭제' },
  saveBtn: { en: 'Save', de: 'Speichern', ja: '保存', ko: '저장' },
  daysShort: { en: '{n}d', de: '{n} T.', ja: '{n}日', ko: '{n}일' },
  unitsCount: { en: '{n} units', de: '{n} Einheiten', ja: '{n}台', ko: '{n}대' },
  bySource: { en: 'by {name}', de: 'von {name}', ja: '{name}による', ko: '{name} 작성' },

  // ---- feed categories + kinds (ActivityFeed / FeedList) ----
  feedCatNeedle: { en: 'Progress', de: 'Fortschritt', ja: '進捗', ko: '진행' },
  feedCatHill: { en: 'Phases', de: 'Phasen', ja: 'フェーズ', ko: '단계' },
  feedCatCreated: { en: 'Created', de: 'Erstellt', ja: '作成', ko: '생성' },
  noActivityYet: { en: 'No activity yet.', de: 'Noch keine Aktivität.', ja: 'まだアクティビティはありません。', ko: '아직 활동이 없습니다.' },
  noMatchingUpdates: { en: 'No matching updates.', de: 'Keine passenden Updates.', ja: '一致する更新はありません。', ko: '일치하는 업데이트가 없습니다.' },
  searchActivity: { en: 'Search activity…', de: 'Aktivität durchsuchen…', ja: 'アクティビティを検索…', ko: '활동 검색…' },
  nothingHereYet: { en: 'Nothing here yet.', de: 'Noch nichts vorhanden.', ja: 'まだ何もありません。', ko: '아직 아무것도 없습니다.' },
  removeThisUpdate: { en: 'Remove this update', de: 'Dieses Update entfernen', ja: 'この更新を削除', ko: '이 업데이트 제거' },

  // ---- unified search ----
  searchPlaceholderShort: { en: 'Search…', de: 'Suchen…', ja: '検索…', ko: '검색…' },
  searchBtn: { en: 'Search', de: 'Suchen', ja: '検索', ko: '검색' },
  searchingBtn: { en: 'Searching…', de: 'Suche läuft…', ja: '検索中…', ko: '검색 중…' },
  searchResultsScopeOne: { en: '1 result in this scope', de: '1 Ergebnis in diesem Bereich', ja: 'このスコープで1件', ko: '이 범위에서 1개 결과' },
  searchResultsScope: { en: '{n} results in this scope', de: '{n} Ergebnisse in diesem Bereich', ja: 'このスコープで{n}件', ko: '이 범위에서 {n}개 결과' },
  searchResultsEcosystemOne: { en: '1 result across the ecosystem', de: '1 Ergebnis im gesamten Ökosystem', ja: 'エコシステム全体で1件', ko: '에코시스템 전체에서 1개 결과' },
  searchResultsEcosystem: { en: '{n} results across the ecosystem', de: '{n} Ergebnisse im gesamten Ökosystem', ja: 'エコシステム全体で{n}件', ko: '에코시스템 전체에서 {n}개 결과' },
  searchNoMatches: {
    en: 'No matches. Try different terms or enable more types.',
    de: 'Keine Treffer. Andere Begriffe versuchen oder mehr Typen aktivieren.',
    ja: '一致なし。別のキーワードを試すか、タイプを増やしてください。',
    ko: '일치 항목이 없습니다. 다른 검색어를 쓰거나 더 많은 유형을 켜 보세요.',
  },
  // ---- program brief ----

  // ---- project admin controls ----
  archiveShort: { en: 'Archive', de: 'Archivieren', ja: 'アーカイブ', ko: '보관' },
  unarchiveShort: { en: 'Unarchive', de: 'Wiederherstellen', ja: 'アーカイブ解除', ko: '보관 해제' },
  unarchiveProject: { en: 'Unarchive Program', de: 'Programm wiederherstellen', ja: 'プログラムのアーカイブを解除', ko: '프로그램 보관 해제' },
  archiveProject: { en: 'Archive Program', de: 'Programm archivieren', ja: 'プログラムをアーカイブ', ko: '프로그램 보관' },
  deleteProject: { en: 'Delete Program', de: 'Programm löschen', ja: 'プログラムを削除', ko: '프로그램 삭제' },
  confirmProjectDeletion: { en: 'Confirm Program Deletion', de: 'Programmlöschung bestätigen', ja: 'プログラム削除の確認', ko: '프로그램 삭제 확인' },
  deleteWarning: {
    en: 'Are you sure you want to delete this program? This will permanently remove all associated phases, action items, and status log histories.',
    de: 'Dieses Programm wirklich löschen? Alle zugehörigen Phasen, Action Items und Statusverläufe werden dauerhaft entfernt.',
    ja: 'このプログラムを削除しますか？関連するすべてのフェーズ、アクションアイテム、ステータス履歴が完全に削除されます。',
    ko: '이 프로그램을 삭제하시겠습니까? 관련된 모든 단계, 액션 아이템, 상태 기록이 영구적으로 제거됩니다.',
  },
  cannotBeUndone: { en: 'This action cannot be undone.', de: 'Diese Aktion kann nicht rückgängig gemacht werden.', ja: 'この操作は元に戻せません。', ko: '이 작업은 되돌릴 수 없습니다.' },
  confirmTypeName: {
    en: 'Please type the name of the program to confirm',
    de: 'Zur Bestätigung bitte den Programmnamen eingeben',
    ja: '確認のためプログラム名を入力してください',
    ko: '확인을 위해 프로그램 이름을 입력하세요',
  },
  typeProjectNameExactly: { en: 'Type program name exactly', de: 'Programmnamen exakt eingeben', ja: 'プログラム名を正確に入力', ko: '프로그램 이름을 정확히 입력' },
  permanentlyDeleteProject: { en: 'Permanently Delete Program', de: 'Programm endgültig löschen', ja: 'プログラムを完全に削除', ko: '프로그램 영구 삭제' },

  // ---- history lists / charts ----
  noUpdatesRecorded: { en: 'No updates recorded yet.', de: 'Noch keine Updates erfasst.', ja: 'まだ更新は記録されていません。', ko: '아직 기록된 업데이트가 없습니다.' },
  noNoteForUpdate: { en: 'No note for this update.', de: 'Keine Notiz zu diesem Update.', ja: 'この更新にはメモがありません。', ko: '이 업데이트에는 메모가 없습니다.' },
  noStatusHistory: { en: 'No status history yet.', de: 'Noch kein Statusverlauf.', ja: 'ステータス履歴はまだありません。', ko: '아직 상태 기록이 없습니다.' },
  healthProgressOverTime: { en: 'Health and progress over time', de: 'Status und Fortschritt im Zeitverlauf', ja: '健全性と進捗の推移', ko: '시간에 따른 상태 및 진행률' },
  progressOverTime: { en: 'Progress over time', de: 'Fortschritt im Zeitverlauf', ja: '進捗の推移', ko: '시간에 따른 진행률' },
  notStartedAxis: { en: 'Not started', de: 'Nicht begonnen', ja: '未着手', ko: '시작 전' },
  maxLabel: { en: 'Max', de: 'Max', ja: '最大', ko: '최대' },
  pointProgressTitle: { en: '{d} · progress', de: '{d} · Fortschritt', ja: '{d} · 進捗', ko: '{d} · 진행률' },
  pointHealthTitle: { en: '{d} · health {h}', de: '{d} · Status {h}', ja: '{d} · 健全性 {h}', ko: '{d} · 상태 {h}' },
  progressOverTimeDot: { en: 'Progress over time.', de: 'Fortschritt im Zeitverlauf.', ja: '進捗の推移。', ko: '시간에 따른 진행률입니다.' },
  progressHealthOverTimeDot: { en: 'Progress & health over time.', de: 'Fortschritt & Status im Zeitverlauf.', ja: '進捗と健全性の推移。', ko: '시간에 따른 진행률 및 상태입니다.' },
  changesHeading: { en: 'Changes', de: 'Änderungen', ja: '変更履歴', ko: '변경 내역' },

  // ---- hill chart control + cycle time ----
  hillProgressAria: { en: 'Progress on the hill (0–100%); use arrow keys to adjust', de: 'Fortschritt auf dem Hügel (0–100 %); mit den Pfeiltasten anpassen', ja: 'ヒル上の進捗（0〜100%）。矢印キーで調整', ko: '힐 진행도(0–100%); 화살표 키로 조정' },
  workingItOut: { en: 'Working it out', de: 'Klären', ja: '模索中', ko: '파악 중' },
  gettingItDone: { en: 'Getting it done', de: 'Umsetzen', ja: '仕上げ中', ko: '마무리 중' },
  notEnoughCycleTime: { en: 'Not enough cycle time data to visualize.', de: 'Nicht genug Zykluszeit-Daten für eine Darstellung.', ja: '可視化に十分なサイクルタイムデータがありません。', ko: '시각화할 사이클 타임 데이터가 부족합니다.' },
  cyclePointTitle: { en: '{name}: {n} days {status}', de: '{name}: {n} Tage {status}', ja: '{name}: {n}日 {status}', ko: '{name}: {n}일 {status}' },
  finishedParen: { en: '(Finished)', de: '(Fertig)', ja: '（完了）', ko: '(완료)' },
  activeParen: { en: '(Active)', de: '(Aktiv)', ja: '（進行中）', ko: '(진행 중)' },
  // ---- SOP chart ----
  sopChartEmpty: {
    en: 'No active programs with target SOP dates found. Edit programs to set SOP target dates.',
    de: 'Keine aktiven Programme mit SOP-Zieldaten gefunden. Programme bearbeiten, um SOP-Ziele zu setzen.',
    ja: '目標SOP日を持つアクティブなプログラムがありません。プログラムを編集してSOP目標日を設定してください。',
    ko: '목표 SOP 날짜가 있는 활성 프로그램이 없습니다. 프로그램을 편집해 SOP 목표일을 설정하세요.',
  },
  sopChartSub: {
    en: 'Anticipated units shipping per program (bars) and running industry volume total (line)',
    de: 'Erwartete Stückzahlen je Programm (Balken) und kumuliertes Branchenvolumen (Linie)',
    ja: 'プログラム別の出荷予定台数（棒）と業界累計台数（線）',
    ko: '프로그램별 예상 출하량(막대)과 업계 누적 물량(선)',
  },
  sopHoverHint: {
    en: 'Hover over any bar or node to examine program shipping volumes.',
    de: 'Über Balken oder Punkte fahren, um Programmvolumen anzuzeigen.',
    ja: 'バーやノードにカーソルを合わせると、プログラムの出荷台数を確認できます。',
    ko: '막대나 점 위에 마우스를 올리면 프로그램 출하량을 확인할 수 있습니다.',
  },

  // ---- data table (shared) ----
  noResultsFound: { en: 'No results found.', de: 'Keine Ergebnisse gefunden.', ja: '結果が見つかりません。', ko: '결과가 없습니다.' },
  showingResults: { en: 'Showing {a}-{b} of {c} results', de: '{a}-{b} von {c} Ergebnissen', ja: '{c}件中 {a}-{b}件を表示', ko: '{c}개 중 {a}-{b} 표시' },
  prev: { en: 'Prev', de: 'Zurück', ja: '前へ', ko: '이전' },
  next: { en: 'Next', de: 'Weiter', ja: '次へ', ko: '다음' },
  pageOf: { en: 'Page {a} of {b}', de: 'Seite {a} von {b}', ja: '{b}ページ中 {a}ページ', ko: '{b}페이지 중 {a}페이지' },
  rowsPerPage: { en: 'Rows', de: 'Zeilen', ja: '行数', ko: '행 수' },

  // ---- tables: shared headers ----
  programName: { en: 'Program Name', de: 'Programmname', ja: 'プログラム名', ko: '프로그램 이름' },
  projectNameHeader: { en: 'Program Name', de: 'Programmname', ja: 'プログラム名', ko: '프로그램 이름' },
  partnerName: { en: 'Partner Name', de: 'Partnername', ja: 'パートナー名', ko: '파트너 이름' },
  programOwner: { en: 'Program Owner', de: 'Programmverantwortlicher', ja: 'プログラムオーナー', ko: '프로그램 담당자' },
  targetSopHeader: { en: 'Target SOP', de: 'SOP-Ziel', ja: '目標SOP', ko: '목표 SOP' },
  // /programs "SOP outlook" column — the deterministic critical-chain buffer vs the
  // target SOP (lib/sop.sopBufferCategory). The ecosystem "SOP at risk" tile deep-links
  // to ?sopOutlook=late.
  sopOutlookHeader: { en: 'SOP outlook', de: 'SOP-Aussicht', ja: 'SOP見通し', ko: 'SOP 전망' },
  sopOutlookLate: { en: 'At risk', de: 'Gefährdet', ja: '遅延リスク', ko: '위험' },
  sopOutlookOnTrack: { en: 'On track', de: 'Im Plan', ja: '順調', ko: '정상' },
  sopOutlookNoSop: { en: 'No target', de: 'Kein Ziel', ja: '目標なし', ko: '목표 없음' },
  sopOutlookNa: { en: '—', de: '—', ja: '—', ko: '—' },
  oemPartnerHeader: { en: 'OEM / Partner', de: 'OEM / Partner', ja: 'OEM / パートナー', ko: 'OEM / 파트너' },
  currentPhase: { en: 'Current Phase', de: 'Aktuelle Phase', ja: '現在のフェーズ', ko: '현재 단계' },
  figuringItOutTime: { en: '"Figuring it out" Time', de: '„Klären“-Dauer', ja: '「模索」時間', ko: '"파악" 시간' },
  theNeedle: { en: 'The Needle', de: 'Die Nadel', ja: 'ニードル', ko: '니들' },
  lastUpdate: { en: 'Last Update', de: 'Letztes Update', ja: '最終更新', ko: '마지막 업데이트' },
  blockedTag: { en: '(Blocked)', de: '(Blockiert)', ja: '（ブロック中）', ko: '(차단됨)' },
  priority: { en: 'Priority', de: 'Priorität', ja: '優先度', ko: '우선순위' },
  substantiveBlocker: { en: 'Substantive Blocker', de: 'Wesentlicher Blocker', ja: '重大なブロッカー', ko: '주요 블로커' },
  filterHealthTitle: { en: 'Filter health: {h}', de: 'Nach Status filtern: {h}', ja: '健全性で絞り込み: {h}', ko: '상태 필터: {h}' },
  noProgramsMatchFilters: { en: 'No programs match current filters.', de: 'Keine Programme entsprechen den Filtern.', ja: '現在のフィルターに一致するプログラムはありません。', ko: '현재 필터와 일치하는 프로그램이 없습니다.' },

  // ---- template library + editor ----
  programTemplates: { en: 'Program templates', de: 'Programmvorlagen', ja: 'プログラムテンプレート', ko: '프로그램 템플릿' },
  newTemplate: { en: 'New template', de: 'Neue Vorlage', ja: '新規テンプレート', ko: '새 템플릿' },
  templateLabel: { en: 'Template', de: 'Vorlage', ja: 'テンプレート', ko: '템플릿' },
  origin: { en: 'Origin', de: 'Herkunft', ja: '作成元', ko: '출처' },
  builtIn: { en: 'Built-in', de: 'Integriert', ja: '組み込み', ko: '기본 제공' },
  backToTemplates: { en: '← Templates', de: '← Vorlagen', ja: '← テンプレート', ko: '← 템플릿' },
  builtinCloneToEdit: { en: 'Built-in — clone to edit', de: 'Integriert — zum Bearbeiten duplizieren', ja: '組み込み — 編集するには複製', ko: '기본 제공 — 편집하려면 복제' },
  leadLabel: { en: 'Lead', de: 'Leitung', ja: 'リード', ko: '리드' },
  weeksLabel: { en: 'Weeks', de: 'Wochen', ja: '週数', ko: '주' },
  dependsOn: { en: 'Depends on', de: 'Abhängig von', ja: '依存先', ko: '의존 대상' },
  endTag: { en: 'End', de: 'Ende', ja: '終了', ko: '종료' },
  templateName: { en: 'Template name', de: 'Vorlagenname', ja: 'テンプレート名', ko: '템플릿 이름' },
  templateDescription: { en: 'Template description', de: 'Vorlagenbeschreibung', ja: 'テンプレートの説明', ko: '템플릿 설명' },
  programLevelDescription: { en: 'Program-level description…', de: 'Beschreibung auf Programmebene…', ja: 'プログラムレベルの説明…', ko: '프로그램 수준 설명…' },
  templateDagPreview: { en: 'Template DAG preview', de: 'Vorlagen-DAG-Vorschau', ja: 'テンプレートDAGプレビュー', ko: '템플릿 DAG 미리보기' },

  // ---- phase DAG editor ----
  removePhaseHistoryConfirm: {
    en: 'Remove “{name}” and its recorded history?',
    de: '„{name}“ und den erfassten Verlauf entfernen?',
    ja: '「{name}」と記録された履歴を削除しますか？',
    ko: '“{name}”과(와) 기록된 이력을 제거하시겠습니까?',
  },
  fixGraphErrors: { en: 'Fix the graph errors first', de: 'Zuerst die Graphfehler beheben', ja: '先にグラフのエラーを修正してください', ko: '먼저 그래프 오류를 수정하세요' },
  dagHintIntro: {
    en: 'Click a node to edit it. To add a dependency: click a second node, then choose',
    de: 'Knoten anklicken, um ihn zu bearbeiten. Für eine Abhängigkeit: zweiten Knoten anklicken und dann',
    ja: 'ノードをクリックすると編集できます。依存関係を追加するには、2つ目のノードをクリックして',
    ko: '노드를 클릭하면 편집할 수 있습니다. 의존성을 추가하려면 두 번째 노드를 클릭한 뒤',
  },
  dagAfterQ: { en: '“…after…”', de: '„…nach…“', ja: '「…の後…」', ko: '“…이후…”' },
  dagOr: { en: 'or', de: 'oder', ja: 'または', ko: '또는' },
  dagBeforeQ: { en: '“…before…”', de: '„…vor…“', ja: '「…の前…」', ko: '“…이전…”' },
  dagHintRest: {
    en: '— or drag a node onto the one it should come after. Branches may fan out and back in freely; every branch must converge on one final node, with no cycles.',
    de: 'wählen — oder einen Knoten auf seinen Vorgänger ziehen. Zweige dürfen sich frei verzweigen und wieder zusammenführen; alle müssen zyklenfrei in einem Endknoten münden.',
    ja: 'を選択します。または、後に続くノードへドラッグしてください。分岐は自由に広がり合流できますが、すべての分岐は循環なしで1つの最終ノードに収束する必要があります。',
    ko: '를 선택하세요. 또는 노드를 선행 노드 위로 드래그하세요. 분기는 자유롭게 갈라지고 합쳐질 수 있지만, 모든 분기는 순환 없이 하나의 최종 노드로 수렴해야 합니다.',
  },
  unnamed: { en: '(unnamed)', de: '(unbenannt)', ja: '（名称未設定）', ko: '(이름 없음)' },
  endPhaseTag: { en: 'end phase', de: 'Endphase', ja: '最終フェーズ', ko: '종료 단계' },
  phaseNameLabel: { en: 'Phase name', de: 'Phasenname', ja: 'フェーズ名', ko: '단계 이름' },
  phaseNamePlaceholder: { en: 'Phase name…', de: 'Phasenname…', ja: 'フェーズ名…', ko: '단계 이름…' },
  forecastWeeks: { en: 'Forecast (weeks)', de: 'Prognose (Wochen)', ja: '予測（週）', ko: '예측 (주)' },
  leadRoleLabel: { en: 'Lead role', de: 'Leitende Rolle', ja: 'リード役割', ko: '리드 역할' },
  descriptionLabel: { en: 'Goal & definition of done', de: 'Ziel & Definition of done', ja: 'ゴールと完了の定義', ko: '목표 및 완료 정의' },
  disconnectName: { en: 'Disconnect {name}', de: '{name} trennen', ja: '{name}との接続を解除', ko: '{name} 연결 해제' },
  connectLabel: { en: 'Connect', de: 'Verbinden', ja: '接続', ko: '연결' },
  connectHint: { en: 'click the node to connect this one to…', de: 'Knoten anklicken, mit dem verbunden werden soll…', ja: '接続先のノードをクリックしてください…', ko: '연결할 노드를 클릭하세요…' },
  connectAfterBtn: { en: '“{a}” after “{b}”', de: '„{a}“ nach „{b}“', ja: '「{a}」を「{b}」の後に', ko: '“{a}”을(를) “{b}” 이후에' },
  connectBeforeBtn: { en: '“{a}” before “{b}”', de: '„{a}“ vor „{b}“', ja: '「{a}」を「{b}」の前に', ko: '“{a}”을(를) “{b}” 이전에' },
  phasesHeading: { en: 'Phases — {name}', de: 'Phasen — {name}', ja: 'フェーズ — {name}', ko: '단계 — {name}' },
  // ---- ecosystem dashboard (home) + summary ----
  ecosystemDashboard: { en: 'Ecosystem Dashboard', de: 'Ökosystem-Dashboard', ja: 'エコシステムダッシュボード', ko: '에코시스템 대시보드' },
  actionItemsHeading: { en: 'Action Items', de: 'Action Items', ja: 'アクションアイテム', ko: '액션 아이템' },
  activeBlockers: { en: '{n} active blockers', de: '{n} aktive Blocker', ja: 'アクティブなブロッカー{n}件', ko: '활성 블로커 {n}건' },
  noPendingActionItems: { en: 'No pending action items detected. Clear skies! ☀️', de: 'Keine offenen Action Items. Freie Fahrt! ☀️', ja: '未処理のアクションアイテムはありません。快晴です！☀️', ko: '대기 중인 액션 아이템이 없습니다. 맑음! ☀️' },
  programsAtRisk: { en: 'Programs at Risk', de: 'Gefährdete Programme', ja: 'リスクのあるプログラム', ko: '위험 프로그램' },
  welcomeAutoknow: { en: 'Welcome to AutoKnow 🌱', de: 'Willkommen bei AutoKnow 🌱', ja: 'AutoKnowへようこそ 🌱', ko: 'AutoKnow에 오신 것을 환영합니다 🌱' },
  onboardingIntro: {
    en: 'This tracker helps teams align on Android Automotive OS integrations, Google Automotive Services, and Digital Key standards. Get started by launching your first program from a standard template:',
    de: 'Dieser Tracker hilft Teams, sich zu Android Automotive OS-Integrationen, Google Automotive Services und Digital-Key-Standards abzustimmen. Starte dein erstes Programm aus einer Standardvorlage:',
    ja: 'このトラッカーは、Android Automotive OS統合、Google Automotive Services、デジタルキー標準に関するチームの連携を支援します。標準テンプレートから最初のプログラムを開始しましょう:',
    ko: '이 트래커는 Android Automotive OS 통합, Google Automotive Services, 디지털 키 표준에 대한 팀 협업을 돕습니다. 표준 템플릿에서 첫 프로그램을 시작해 보세요:',
  },
  createProjectFromTemplate: { en: '➕ Create Program from Template', de: '➕ Programm aus Vorlage erstellen', ja: '➕ テンプレートからプログラムを作成', ko: '➕ 템플릿에서 프로그램 만들기' },
  seedMockDataWalkthrough: { en: '⚙️ Seed Mock Data (Walkthrough Mode)', de: '⚙️ Mock-Daten einspielen (Demo-Modus)', ja: '⚙️ モックデータを投入（ウォークスルーモード）', ko: '⚙️ 모의 데이터 채우기 (둘러보기 모드)' },
  priorityCritical: { en: '🔴 Critical', de: '🔴 Kritisch', ja: '🔴 重大', ko: '🔴 심각' },
  priorityWarning: { en: '🟡 Warning', de: '🟡 Warnung', ja: '🟡 警告', ko: '🟡 경고' },
  progressFloorHill: { en: 'Progress Floor (Hill Chart)', de: 'Fortschritts-Untergrenze (Hügeldiagramm)', ja: '進捗の下限（ヒルチャート）', ko: '진행률 하한 (힐 차트)' },
  programsInFlight: { en: 'Programs in Flight', de: 'Laufende Programme', ja: '進行中のプログラム', ko: '진행 중인 프로그램' },
  activeImplementations: { en: 'Active implementations', de: 'Aktive Implementierungen', ja: 'アクティブな実装', ko: '활성 구현' },
  total12mVolume: { en: 'Total 12M Volume', de: 'Gesamtvolumen 12M', ja: '12ヶ月合計台数', ko: '12개월 총 물량' },
  shippingUnitsFirstYear: { en: 'Shipping units in first year', de: 'Ausgelieferte Einheiten im ersten Jahr', ja: '初年度出荷台数', ko: '첫해 출하량' },
  programsInRange: { en: 'Programs in Range', de: 'Programme im Bereich', ja: '範囲内のプログラム', ko: '범위 내 프로그램' },
  matchingProgressFilters: { en: 'Matching progress filters', de: 'Passend zu Fortschrittsfiltern', ja: '進捗フィルターに一致', ko: '진행률 필터와 일치' },
  deterministicLeadTime: { en: 'Deterministic Lead Time', de: 'Deterministische Durchlaufzeit', ja: '決定論的リードタイム', ko: '결정론적 리드 타임' },
  wipCompletionCycle: { en: 'WIP completion cycle', de: 'WIP-Abschlusszyklus', ja: 'WIP完了サイクル', ko: 'WIP 완료 주기' },
  attentionLeaders: { en: 'Attention Leaders:', de: 'Achtung, Führungskräfte:', ja: 'リーダーの皆さまへ:', ko: '리더 주목:' },
  flaggedPrograms: {
    en: '{n} programs are flagged Some Risk or Concerned. Immediate review of dependencies advised.',
    de: '{n} Programme sind als „Some Risk“ oder „Concerned“ markiert. Sofortige Prüfung der Abhängigkeiten empfohlen.',
    ja: '{n}件のプログラムが「ややリスク」または「懸念あり」です。依存関係の早急な確認を推奨します。',
    ko: '{n}개 프로그램이 ‘다소 위험’ 또는 ‘우려’로 표시되었습니다. 의존성의 즉각적인 검토를 권장합니다.',
  },
  cycleTimePointChart: { en: 'Cycle Time Point Chart', de: 'Zykluszeit-Punktdiagramm', ja: 'サイクルタイム散布図', ko: '사이클 타임 포인트 차트' },
  ecosystemSummary: { en: 'Ecosystem Summary', de: 'Ökosystem-Übersicht', ja: 'エコシステムサマリー', ko: '에코시스템 요약' },
  withinSelectedRange: { en: 'Within selected progress range', de: 'Im gewählten Fortschrittsbereich', ja: '選択した進捗範囲内', ko: '선택한 진행률 범위 내' },
  averagePhaseDuration: { en: 'Average phase duration', de: 'Durchschnittliche Phasendauer', ja: '平均フェーズ期間', ko: '평균 단계 기간' },
  flowConstraintDiagnosis: { en: 'Flow Constraint Diagnosis', de: 'Fluss-Engpass-Diagnose', ja: 'フロー制約診断', ko: '흐름 제약 진단' },
  flowConstraintSub: { en: 'Phases on a critical chain right now — what is gating an SOP today', de: 'Phasen, die derzeit auf einer kritischen Kette liegen — was heute einen SOP blockiert', ja: '現在クリティカルチェーン上にあるフェーズ — 今SOPを律速しているもの', ko: '현재 크리티컬 체인에 있는 단계 — 지금 SOP를 막고 있는 것' },
  primaryConstraint: { en: 'Primary constraint', de: 'Haupt-Engpass', ja: '主要制約', ko: '주요 제약' },
  onCriticalChain: { en: 'On a critical chain', de: 'Auf einer kritischen Kette', ja: 'クリティカルチェーン上', ko: '크리티컬 체인에 있음' },
  gatingOneProgram: { en: 'gating 1 program', de: 'blockiert 1 Programm', ja: '1件のプログラムを律速', ko: '1개 프로그램을 제약' },
  gatingNPrograms: { en: 'gating {n} programs', de: 'blockiert {n} Programme', ja: '{n}件のプログラムを律速', ko: '{n}개 프로그램을 제약' },
  noLiveConstraints: { en: 'No phase is on a critical chain right now.', de: 'Derzeit liegt keine Phase auf einer kritischen Kette.', ja: '現在クリティカルチェーン上のフェーズはありません。', ko: '현재 크리티컬 체인에 있는 단계가 없습니다.' },
  programLifecycleLaunches: { en: 'Program Lifecycle & Launches', de: 'Programmlebenszyklus & Starts', ja: 'プログラムのライフサイクルとローンチ', ko: '프로그램 라이프사이클 및 출시' },
  volume12m: { en: '12M Volume', de: '12M-Volumen', ja: '12ヶ月台数', ko: '12개월 물량' },
  hillChartHeader: { en: 'Hill Chart', de: 'Hügeldiagramm', ja: 'ヒルチャート', ko: '힐 차트' },
  earlyStage: { en: 'Early Stage', de: 'Frühphase', ja: '初期段階', ko: '초기 단계' },

  // ---- programs page ----
  searchPrograms: { en: 'Search Programs', de: 'Programme suchen', ja: 'プログラムを検索', ko: '프로그램 검색' },
  partnerType: { en: 'Partner Type', de: 'Partnertyp', ja: 'パートナー種別', ko: '파트너 유형' },
  allTypes: { en: 'All Types', de: 'Alle Typen', ja: 'すべての種別', ko: '모든 유형' },
  typeOnly: { en: '{t} Only', de: 'Nur {t}', ja: '{t}のみ', ko: '{t}만' },
  googleRegion: { en: 'Google Region', de: 'Google-Region', ja: 'Googleリージョン', ko: 'Google 지역' },
  regionLabel: { en: 'Region', de: 'Region', ja: '地域', ko: '지역' },
  structureLabel: { en: 'Structure', de: 'Struktur', ja: '構造', ko: '구조' },
  phaseKeyTitle: { en: 'How to read this', de: 'Lesehilfe', ja: 'この図の読み方', ko: '읽는 방법' },
  nameLabel: { en: 'Name', de: 'Name', ja: '名前', ko: '이름' },
  companyLabel: { en: 'Company', de: 'Unternehmen', ja: '会社', ko: '회사' },
  fromLabel: { en: 'From', de: 'Von', ja: '開始', ko: '시작' },
  toLabel: { en: 'To', de: 'Bis', ja: '終了', ko: '종료' },
  emailHeader: { en: 'Email', de: 'E-Mail', ja: 'メール', ko: '이메일' },
  historyLabel: { en: 'History', de: 'Historie', ja: '経歴', ko: '이력' },
  newPerson: { en: 'New person', de: 'Neue Person', ja: '担当者を追加', ko: '새 인물' },
  addToProgram: { en: 'Add to program', de: 'Zu Programm hinzufügen', ja: 'プログラムに追加', ko: '프로그램에 추가' },
  createMyProfile: { en: 'Create my profile', de: 'Mein Profil erstellen', ja: 'マイプロフィールを作成', ko: '내 프로필 만들기' },
  selectProgram: { en: 'Select program…', de: 'Programm wählen…', ja: 'プログラムを選択…', ko: '프로그램 선택…' },
  selectPhase: { en: 'Select phase…', de: 'Phase wählen…', ja: 'フェーズを選択…', ko: '단계 선택…' },
  noAffiliations: {
    en: 'No employment history recorded.',
    de: 'Keine Beschäftigungshistorie erfasst.',
    ja: '所属履歴は登録されていません。',
    ko: '소속 이력이 등록되지 않았습니다.',
  },
  noPriorCompanies: {
    en: 'No companies before {c}.',
    de: 'Keine Unternehmen vor {c}.',
    ja: '{c} 以前の所属はありません。',
    ko: '{c} 이전 소속 회사가 없습니다.',
  },
  noProfileForUser: {
    en: 'No person profile matches {u} yet. Browse the directory:',
    de: 'Noch kein Personenprofil für {u}. Zum Verzeichnis:',
    ja: '{u} に一致する人物プロフィールがまだありません。ディレクトリへ:',
    ko: '{u}와 일치하는 인물 프로필이 아직 없습니다. 디렉터리 보기:',
  },
  allRegions: { en: 'All Regions', de: 'Alle Regionen', ja: 'すべてのリージョン', ko: '모든 지역' },
  programsInFlightAllTime: { en: 'Programs In Flight / All Time', de: 'Laufende Programme / Gesamt', ja: '進行中 / 全期間のプログラム', ko: '진행 중 / 전체 프로그램' },
  activeVsTotal: { en: 'Active vs total matches', de: 'Aktive vs. Gesamttreffer', ja: 'アクティブ vs 全一致件数', ko: '활성 대 전체 일치' },
  someRiskConcerned: { en: 'Some Risk / Concerned', de: 'Etwas Risiko / Besorgt', ja: 'ややリスク / 懸念あり', ko: '다소 위험 / 우려' },
  atElevatedRisk: { en: 'At elevated risk level', de: 'Mit erhöhtem Risiko', ja: 'リスク水準が高い', ko: '높은 위험 수준' },
  // ---- partners list + partner detail ----
  loggedUser: { en: 'Logged User:', de: 'Angemeldeter Nutzer:', ja: 'ログインユーザー:', ko: '로그인 사용자:' },
  myPartners: { en: 'My partners', de: 'Meine Partner', ja: 'マイパートナー', ko: '내 파트너' },
  activePrograms: { en: 'Active Programs', de: 'Aktive Programme', ja: 'アクティブなプログラム', ko: '활성 프로그램' },
  lifetimePrograms: { en: 'Lifetime Programs', de: 'Programme insgesamt', ja: '累計プログラム', ko: '누적 프로그램' },
  telsHeader: { en: 'Technical Engagement Leads', de: 'Technische Engagement-Leads', ja: 'テクニカルエンゲージメントリード', ko: '기술 참여 리드' },
  // Singular of telsHeader — the badge shows the acronym, this is its expansion on hover.
  telRole: { en: 'Technical Engagement Lead', de: 'Technischer Engagement-Lead', ja: 'テクニカルエンゲージメントリード', ko: '기술 참여 리드' },
  // The People table's two program-count columns (#243) — see the aria-label pair
  // below for why they are two columns and not one.
  programsLedLabel: { en: 'Programs Led', de: 'Geleitete Programme', ja: '主導プログラム', ko: '주도 프로그램' },
  programsInvolvedLabel: { en: 'Programs Involved', de: 'Beteiligte Programme', ja: '関与プログラム', ko: '참여 프로그램' },
  // The person page's Programs table Connection column (#243): a first-class
  // discriminator for "leads it" vs "is named on it", where the TEL badge used to be
  // the only marker and lived inside the Role column instead.
  connectionHeader: { en: 'Connection', de: 'Verbindung', ja: '関わり方', ko: '연결' },
  involvedConnectionLabel: { en: 'Involved', de: 'Beteiligt', ja: '関与', ko: '참여' },
  involvedConnectionTitle: {
    en: 'Named on a phase or holding an action item in this program',
    de: 'In einer Phase genannt oder mit einer Aufgabe in diesem Programm betraut',
    ja: 'このプログラムのフェーズに名前があるか、アクションアイテムを担当しています',
    ko: '이 프로그램의 단계에 이름이 올라 있거나 액션 아이템을 맡고 있습니다',
  },
  roleHeader: { en: 'Role', de: 'Rolle', ja: '役割', ko: '역할' },
  // The Programs table's affiliation-held-then column (#127 E11). Deliberately not
  // "Company": the program's partner is also a company, and this column answers a
  // different question — the job the connection was made through.
  affiliationHeader: { en: 'Affiliation', de: 'Zugehörigkeit', ja: '所属', ko: '소속' },
  // The Programs table's live/ended class (#144). "Current"/"Ended" and not
  // "Active"/"Inactive": a program has its OWN lifecycle with those words, and this is a
  // statement about the PERSON's connection to it, not about the program.
  connectionLive: { en: 'Current', de: 'Aktuell', ja: '現在', ko: '현재' },
  connectionEnded: { en: 'Ended', de: 'Beendet', ja: '終了', ko: '종료' },
  // WHY a row is on the Programs table when neither the TEL badge nor a phase role says
  // so: the person holds an action item on one of its phases and nothing else (#144).
  viaActionItem: { en: 'action item', de: 'Aufgabe', ja: 'アクションアイテム', ko: '액션 아이템' },
  // What the Phases column actually contains — two provenances, neither filtered by
  // status — and what the Affiliation column MEANS: the job held at the time of the
  // involvement, not the job held now (#127 E11, the same per-row rule the Activity
  // intro below states for its own rows).
  personProgramsIntro: {
    en: 'Programs this person is named on — as Technical Engagement Lead, on a phase, or holding an action item there. Each row shows the company and role held at the time, and whether the connection is current or has ended. A connection reads current until every phase behind it is finished, so a phase nobody has updated counts as current.',
    de: 'Programme, in denen diese Person genannt ist — als Technical Engagement Lead, in einer Phase oder mit einer Aufgabe darin. Jede Zeile zeigt Unternehmen und Rolle zum Zeitpunkt der Beteiligung sowie ob die Verbindung aktuell oder beendet ist. Eine Verbindung gilt als aktuell, solange nicht jede zugehörige Phase abgeschlossen ist — eine nie aktualisierte Phase zählt also als aktuell.',
    ja: 'この担当者が名前を連ねているプログラム — TEL として、フェーズ上、またはアクションアイテムの担当として。各行には関与当時の会社と役割、および接続が現在有効か終了済みかが表示されます。関連するすべてのフェーズが完了するまで「現在」と表示されるため、未更新のフェーズは「現在」として扱われます。',
    ko: '이 사람이 이름을 올린 프로그램 — TEL로서, 단계에서, 또는 액션 아이템 보유. 각 행에는 참여 당시의 회사와 역할, 그리고 연결이 현재인지 종료되었는지가 표시됩니다. 관련된 모든 단계가 끝나야 종료로 바뀌므로, 갱신되지 않은 단계는 현재로 간주됩니다.',
  },
  // Two sentences, both load-bearing. The first says what the company beside each entry
  // MEANS — the job held then, not the job held now (#127 E10). The second states the
  // limit rather than absorbing it: the actor on an update is a free-text handle, so
  // seeded, API-written and machine re-checked entries name no human and are absent by
  // construction. "Degrade with an honest message, never a faked result" is the rule; an
  // unexplained short list is a faked result, because it reads as this person having
  // done nothing.
  personActivityIntro: {
    en: 'What this person recorded, each entry showing the company and role they held on that day. Entries written by the seed, an API client or an automated re-check carry no author, so they cannot appear here.',
    de: 'Was diese Person erfasst hat — jeder Eintrag zeigt Unternehmen und Rolle, die sie an diesem Tag innehatte. Einträge von Seed-Daten, einem API-Client oder einer automatischen Prüfung haben keinen Autor und können hier nicht erscheinen.',
    ja: 'この担当者が記録した内容です。各エントリには、その日に所属していた会社と役割が表示されます。シード、API クライアント、自動再チェックによるエントリには作成者がないため、ここには表示されません。',
    ko: '이 사람이 기록한 내용이며, 각 항목에는 그날 재직한 회사와 역할이 표시됩니다. 시드, API 클라이언트 또는 자동 재확인으로 작성된 항목은 작성자가 없어 여기에 표시될 수 없습니다.',
  },
  filterByType: { en: 'Filter by {t}', de: 'Nach {t} filtern', ja: '{t}で絞り込み', ko: '{t}(으)로 필터링' },
  // Accessible names for the Partners table count cells (design.md §6, one measure
  // per cell): the visible cell is the bare number, the noun it counts lives here.
  // Split singular/plural because EN/DE inflect the noun; JA/KO use counters that do
  // not, so their two forms are intentionally identical.
  activeProgramsAriaOne: { en: '{n} active program', de: '{n} aktives Programm', ja: 'アクティブなプログラム{n}件', ko: '활성 프로그램 {n}개' },
  activeProgramsAria: { en: '{n} active programs', de: '{n} aktive Programme', ja: 'アクティブなプログラム{n}件', ko: '활성 프로그램 {n}개' },
  lifetimeProgramsAriaOne: { en: '{n} lifetime program', de: '{n} Programm insgesamt', ja: '累計プログラム{n}件', ko: '누적 프로그램 {n}개' },
  lifetimeProgramsAria: { en: '{n} lifetime programs', de: '{n} Programme insgesamt', ja: '累計プログラム{n}件', ko: '누적 프로그램 {n}개' },
  // Same rule for the People table's two program-count cells (#243) — the noun lives
  // in the link's accessible name so it is not announced as a context-free number.
  // These replaced a single "programs" count that unioned TEL ownership with phase/
  // action-item involvement into one number — the union is exactly the bug: a TEL
  // with no phase involvement vanished from that count while still on their own page.
  programsLedAriaOne: { en: '{n} program led', de: '{n} geleitetes Programm', ja: '主導プログラム{n}件', ko: '주도 프로그램 {n}개' },
  programsLedAria: { en: '{n} programs led', de: '{n} geleitete Programme', ja: '主導プログラム{n}件', ko: '주도 프로그램 {n}개' },
  programsInvolvedAriaOne: { en: '{n} program involved', de: '{n} beteiligtes Programm', ja: '関与プログラム{n}件', ko: '참여 프로그램 {n}개' },
  programsInvolvedAria: { en: '{n} programs involved', de: '{n} beteiligte Programme', ja: '関与プログラム{n}件', ko: '참여 프로그램 {n}개' },
  noPartnersMatchFilters: { en: 'No ecosystem partners found matching filters.', de: 'Keine Ökosystem-Partner entsprechen den Filtern.', ja: 'フィルターに一致するパートナーが見つかりません。', ko: '필터와 일치하는 에코시스템 파트너가 없습니다.' },
  partnerProfileSuffix: { en: '{t} Partner Profile', de: '{t}-Partnerprofil', ja: '{t}パートナープロフィール', ko: '{t} 파트너 프로필' },
  relationshipSummary: { en: 'Relationship Summary', de: 'Beziehungsübersicht', ja: '関係サマリー', ko: '관계 요약' },
  keyDetails: { en: 'Key Details', de: 'Eckdaten', ja: '主要情報', ko: '주요 정보' },
  telephone: { en: 'Telephone', de: 'Telefon', ja: '電話', ko: '전화' },
  website: { en: 'Website', de: 'Website', ja: 'ウェブサイト', ko: '웹사이트' },
  visitWebsite: { en: 'Visit Website →', de: 'Website besuchen →', ja: 'ウェブサイトを開く →', ko: '웹사이트 방문 →' },
  internalDocumentation: { en: 'Internal Documentation', de: 'Interne Dokumentation', ja: '社内ドキュメント', ko: '내부 문서' },
  readMoreSharedDrive: { en: 'Read more (Shared Drive) →', de: 'Mehr lesen (Shared Drive) →', ja: '詳細を見る（共有ドライブ）→', ko: '자세히 보기 (공유 드라이브) →' },
  associatedPeople: { en: 'Associated People', de: 'Zugehörige Personen', ja: '関係者', ko: '관련 인물' },
  noAssociatedPeople: { en: 'No associated people found.', de: 'Keine zugehörigen Personen gefunden.', ja: '関係者が見つかりません。', ko: '관련 인물이 없습니다.' },
  noPartnerPrograms: {
    en: 'No programs yet — this partner owns none and is not involved in any phases.',
    de: 'Noch keine Programme — dieser Partner besitzt keine und ist an keinen Phasen beteiligt.',
    ja: 'プログラムはまだありません — このパートナーは所有プログラムがなく、どのフェーズにも関与していません。',
    ko: '아직 프로그램이 없습니다 — 이 파트너는 소유한 프로그램이 없고 어떤 단계에도 참여하지 않습니다.',
  },
  ownedBy: { en: 'Owned by', de: 'Gehört zu', ja: '所有:', ko: '소유:' },

  // ---- person profile ----
  currentOrganization: { en: 'Current Organization:', de: 'Aktuelle Organisation:', ja: '現在の組織:', ko: '현재 조직:' },
  emailLabel: { en: 'Email:', de: 'E-Mail:', ja: 'メール:', ko: '이메일:' },
  careerHistory: { en: 'Career History', de: 'Beruflicher Werdegang', ja: '職歴', ko: '경력 이력' },
  present: { en: 'Present', de: 'Heute', ja: '現在', ko: '현재' },
  actionDecisionHistory: { en: 'Action & Decision History', de: 'Aktions- & Entscheidungsverlauf', ja: 'アクション・意思決定履歴', ko: '액션 및 의사결정 이력' },
  actionHistorySubtext: {
    en: 'Historical activities and program decisions mapped to the organization/role they held at the time of action:',
    de: 'Frühere Aktivitäten und Programmentscheidungen, zugeordnet zur damaligen Organisation/Rolle:',
    ja: '過去の活動とプログラムの意思決定を、当時の組織・役割に対応付けて表示します:',
    ko: '과거 활동과 프로그램 의사결정을 당시의 조직/역할에 매핑하여 표시합니다:',
  },
  noActionsRecorded: { en: 'No actions recorded during this tenure.', de: 'Keine Aktionen in diesem Zeitraum erfasst.', ja: 'この在籍期間中のアクションは記録されていません。', ko: '이 재직 기간에 기록된 액션이 없습니다.' },
  otherUnassociated: { en: 'Other / Unassociated', de: 'Sonstige / Nicht zugeordnet', ja: 'その他 / 未対応付け', ko: '기타 / 미연결' },
  // #127 E3. "Edit details", not "Edit person": what it edits is the record, and the
  // name survived E14 folding the Move dialog into it. Name and Email reuse
  // nameLabel/emailHeader — the same two fields on the same entity as the Create dialog.
  editDetails: { en: 'Edit details', de: 'Details bearbeiten', ja: '詳細を編集', ko: '세부정보 편집' },
  personNotesLabel: { en: 'Notes', de: 'Notizen', ja: 'メモ', ko: '메모' },
  personNotesPlaceholder: {
    en: 'Anything worth knowing about this person',
    de: 'Was über diese Person zu wissen ist',
    ja: 'この人について知っておくとよいこと',
    ko: '이 사람에 대해 알아둘 만한 내용',
  },
  saveChanges: { en: 'Save changes', de: 'Änderungen speichern', ja: '変更を保存', ko: '변경사항 저장' },
  newOrganization: { en: 'New Organization', de: 'Neue Organisation', ja: '新しい組織', ko: '새 조직' },
  // The unified editor's company field (#127 E14). NOT `newOrganization`, which the
  // retired Move dialog used: with no effective date this field is TODAY's employer
  // being corrected in place, and "new" would be the opposite of what is happening.
  organizationLabel: { en: 'Organization', de: 'Organisation', ja: '組織', ko: '조직' },
  selectPartner: { en: 'Select Partner...', de: 'Partner wählen…', ja: 'パートナーを選択...', ko: '파트너 선택...' },
  roleTitle: { en: 'Role / Title', de: 'Rolle / Titel', ja: '役割 / 役職', ko: '역할 / 직함' },
  roleTitlePlaceholder: { en: 'e.g. Lead Systems Architect', de: 'z. B. Leitender Systemarchitekt', ja: '例: リードシステムアーキテクト', ko: '예: 수석 시스템 아키텍트' },
  effectiveDate: { en: 'Effective Date', de: 'Gültig ab', ja: '発効日', ko: '적용일' },
  // The person editor's live readout (#127 E14, spec #124 §3): the dialog states what
  // submitting will DO before it does it, which is what keeps a typo fix from writing a
  // fake job change. Three keys because there are three outcomes, and the reader has to
  // be able to tell "corrects" from "records" WITHOUT parsing a date field — the date is
  // shown too, but the verb carries the meaning.
  reviseCorrects: {
    en: "This corrects {n}'s current details — no change is recorded in their history.",
    de: 'Dies korrigiert die aktuellen Daten von {n} — es wird keine Änderung in der Historie erfasst.',
    ja: 'これは {n} の現在の情報を訂正します（経歴には変更を記録しません）。',
    ko: '{n}의 현재 정보를 정정합니다 — 이력에는 변경이 기록되지 않습니다.',
  },
  reviseRecordsChange: {
    en: 'This records a change effective {d} — the current period ends there and a new one begins.',
    de: 'Dies erfasst eine Änderung gültig ab {d} — der aktuelle Zeitraum endet dort und ein neuer beginnt.',
    ja: 'これは {d} 付けの変更を記録します（現在の期間はそこで終了し、新しい期間が始まります）。',
    ko: '{d}자로 변경을 기록합니다 — 현재 기간이 그날 종료되고 새 기간이 시작됩니다.',
  },
  reviseSchedules: {
    en: 'This schedules a change for {d} — nothing changes until then.',
    de: 'Dies plant eine Änderung für {d} — bis dahin ändert sich nichts.',
    ja: 'これは {d} の変更を予約します（それまでは何も変わりません）。',
    ko: '{d}에 적용될 변경을 예약합니다 — 그때까지는 아무것도 바뀌지 않습니다.',
  },
  // The scheduled-change line on the person page. A pending change nobody can see is
  // #124 Class 1 in a new costume, so it says the company and the day outright.
  scheduledMovesTo: {
    en: 'Scheduled: moves to {c} on {d}',
    de: 'Geplant: Wechsel zu {c} am {d}',
    ja: '予定: {d} に {c} へ異動',
    ko: '예정: {d}에 {c}(으)로 이동',
  },
  // Its own key rather than `cancel`: this UN-RECORDS a scheduled change, where `cancel`
  // dismisses a dialog. Identical in en/de/ko and deliberately different in ja
  // (取り消す = revoke, vs キャンセル = dismiss) — do not "deduplicate" these.
  cancelScheduledChange: { en: 'Cancel', de: 'Abbrechen', ja: '取り消す', ko: '취소' },
  // The "track person" affordance (#126 / #127 E15). Deliberately a VERB and not a noun
  // phrase: the offer is an action on a mention, never a claim about who the mention is.
  trackPerson: { en: 'Track person', de: 'Person erfassen', ja: '担当者を登録', ko: '인물 등록' },
  trackPersonHint: {
    en: 'Create a person record for {a} — nobody is tracked under this address yet',
    de: 'Personendatensatz für {a} anlegen — unter dieser Adresse ist noch niemand erfasst',
    ja: '{a} の担当者レコードを作成します（このアドレスの担当者はまだ登録されていません）',
    ko: '{a}에 대한 인물 레코드를 만듭니다 — 이 주소로 등록된 사람이 아직 없습니다',
  },
  trackPersonIntro: {
    en: 'Creating a person for {a}. The company is a guess from the address domain and the date is when this was written — change either.',
    de: 'Person für {a} anlegen. Das Unternehmen ist aus der Adressdomain geraten, das Datum ist der Zeitpunkt der Erfassung — beides änderbar.',
    ja: '{a} の担当者を作成します。会社はアドレスのドメインからの推測、日付はこれが書かれた時点です。どちらも変更できます。',
    ko: '{a}의 인물을 만듭니다. 회사는 주소 도메인에서 추정한 값이고 날짜는 작성 시점입니다 — 둘 다 변경할 수 있습니다.',
  },
  // Two dates, two honest sentences. #126 decision 3 is that a person first seen in a
  // 2023 document becomes a 2023 fact; where the surface has no date to offer, saying so
  // is better than letting "today" pass for the mention's date.
  trackPersonDateFromMention: {
    en: 'From the date this was written, not today.',
    de: 'Vom Datum der Erfassung, nicht von heute.',
    ja: 'これが書かれた日付です（本日ではありません）。',
    ko: '작성된 날짜 기준이며, 오늘이 아닙니다.',
  },
  trackPersonDateUnknown: {
    en: 'This surface carries no date, so today is a guess — set the real one if you know it.',
    de: 'Diese Ansicht führt kein Datum, heute ist also geraten — tragen Sie das echte ein, wenn bekannt.',
    ja: 'この画面には日付がないため本日を仮置きしています。正しい日付が分かる場合は入力してください。',
    ko: '이 화면에는 날짜가 없어 오늘로 가정했습니다 — 실제 날짜를 알면 입력하세요.',
  },
  notAPerson: { en: 'Not a person', de: 'Keine Person', ja: '担当者ではない', ko: '인물 아님' },
  deletePersonProfile: { en: 'Delete Person Profile', de: 'Personenprofil löschen', ja: 'プロフィールを削除', ko: '프로필 삭제' },
  deleteProfileHelp: { en: 'Permanently removes this profile and career affiliations.', de: 'Entfernt dieses Profil und alle Zugehörigkeiten dauerhaft.', ja: 'このプロフィールと職歴を完全に削除します。', ko: '이 프로필과 경력 소속을 영구적으로 제거합니다.' },
  deleteProfileBtn: { en: 'Delete Profile', de: 'Profil löschen', ja: '削除する', ko: '프로필 삭제' },

  // ---- me page ----
  myActionItems: { en: 'My action items', de: 'Meine Action Items', ja: 'マイアクションアイテム', ko: '내 액션 아이템' },
  actionItemDescription: { en: 'Action Item Description', de: 'Beschreibung des Action Items', ja: 'アクションアイテムの内容', ko: '액션 아이템 설명' },
  projectContext: { en: 'Program Context', de: 'Programmkontext', ja: 'プログラムコンテキスト', ko: '프로그램 컨텍스트' },
  assignedDate: { en: 'Assigned Date', de: 'Zugewiesen am', ja: '割り当て日', ko: '할당일' },
  noPendingAssigned: { en: 'No pending action items assigned to you.', de: 'Keine offenen Action Items für dich.', ja: 'あなたに割り当てられた未処理のアクションアイテムはありません。', ko: '할당된 대기 중 액션 아이템이 없습니다.' },
  myProjects: { en: 'My programs', de: 'Meine Programme', ja: 'マイプログラム', ko: '내 프로그램' },
  activePhase: { en: 'Active Phase', de: 'Aktive Phase', ja: 'アクティブなフェーズ', ko: '활성 단계' },
  noProjectAccountabilities: { en: 'No program accountabilities found for you.', de: 'Keine Programmverantwortlichkeiten für dich gefunden.', ja: 'あなたが担当するプログラムは見つかりません。', ko: '담당 중인 프로그램이 없습니다.' },
  noPartnerRelationships: { en: 'No partner relationships associated with you.', de: 'Keine Partnerbeziehungen mit dir verknüpft.', ja: 'あなたに関連するパートナー関係はありません。', ko: '연결된 파트너 관계가 없습니다.' },

  // ---- activity / ingest / login / search pages ----
  ecosystemActivity: { en: 'Ecosystem activity', de: 'Ökosystem-Aktivität', ja: 'エコシステムのアクティビティ', ko: '에코시스템 활동' },
  ecosystemActivityIntro: {
    en: 'Everything happening across the ecosystem — new programs, needle and progress changes, phase updates, and ingested context. Search to scope it.',
    de: 'Alles, was im Ökosystem passiert — neue Programme, Nadel- und Fortschrittsänderungen, Phasen-Updates und erfasster Kontext. Per Suche eingrenzen.',
    ja: 'エコシステム全体の動き — 新しいプログラム、ニードルや進捗の変化、フェーズ更新、取り込まれたコンテキスト。検索で絞り込めます。',
    ko: '에코시스템 전체에서 일어나는 모든 것 — 새 프로그램, 니들·진행률 변경, 단계 업데이트, 수집된 컨텍스트. 검색으로 범위를 좁혀 보세요.',
  },
  searchAllAutoknow: {
    en: 'Search all of AutoKnow — partners, programs, people, context…',
    de: 'Ganz AutoKnow durchsuchen — Partner, Programme, Personen, Kontext…',
    ja: 'AutoKnow全体を検索 — パートナー・プログラム・担当者・コンテキスト…',
    ko: 'AutoKnow 전체 검색 — 파트너, 프로그램, 사람, 컨텍스트…',
  },
  recentActivity: { en: 'Recent activity', de: 'Neueste Aktivität', ja: '最近のアクティビティ', ko: '최근 활동' },
  loginIntro: {
    en: 'Android Automotive partner & program intelligence. Sign in with your Google Workspace account to continue.',
    de: 'Android Automotive Partner- & Programm-Intelligenz. Mit deinem Google Workspace-Konto anmelden, um fortzufahren.',
    ja: 'Android Automotiveのパートナー・プログラムインテリジェンス。続行するにはGoogle Workspaceアカウントでログインしてください。',
    ko: 'Android Automotive 파트너 및 프로그램 인텔리전스. 계속하려면 Google Workspace 계정으로 로그인하세요.',
  },
  signInWithGoogle: { en: 'Sign in with Google', de: 'Mit Google anmelden', ja: 'Googleでログイン', ko: 'Google로 로그인' },
  authNotConfigured: { en: 'Authentication is not configured. Set', de: 'Authentifizierung ist nicht konfiguriert. Setze', ja: '認証が設定されていません。', ko: '인증이 설정되지 않았습니다.' },
  authAnd: { en: 'and', de: 'und', ja: 'および', ko: '및' },
  authEnableSignin: {
    en: 'to enable Google sign-in. Until then the app runs on a stub identity.',
    de: 'um die Google-Anmeldung zu aktivieren. Bis dahin läuft die App mit einer Platzhalter-Identität.',
    ja: 'を設定するとGoogleログインが有効になります。それまでアプリはスタブIDで動作します。',
    ko: '를 설정하면 Google 로그인이 활성화됩니다. 그 전까지 앱은 스텁 ID로 동작합니다.',
  },
  searchIntro: {
    en: 'Semantic search across partners, programs, people, and ingested context. Use the chips to include or exclude types.',
    de: 'Semantische Suche über Partner, Programme, Personen und erfassten Kontext. Mit den Chips Typen ein- oder ausschließen.',
    ja: 'パートナー・プログラム・担当者・取り込み済みコンテキストを横断するセマンティック検索。チップでタイプを絞り込めます。',
    ko: '파트너, 프로그램, 사람, 수집된 컨텍스트를 아우르는 시맨틱 검색. 칩으로 유형을 포함하거나 제외하세요.',
  },
  searchEverythingPlaceholder: {
    en: 'Search activities, programs, partners, and people…',
    de: 'Aktivitäten, Programme, Partner und Personen suchen…',
    ja: 'アクティビティ・プログラム・パートナー・担当者を検索…',
    ko: '활동, 프로그램, 파트너, 사람 검색…',
  },

  // ---- admin (dev console) ----
  adminSubtext: {
    en: 'Manage test states, seed empty onboarding dashboards, and test webhook endpoints.',
    de: 'Testzustände verwalten, leere Onboarding-Dashboards befüllen und Webhook-Endpunkte testen.',
    ja: 'テスト状態の管理、空のオンボーディングダッシュボードへのデータ投入、Webhookエンドポイントのテストを行います。',
    ko: '테스트 상태 관리, 빈 온보딩 대시보드 시드, 웹훅 엔드포인트 테스트를 수행합니다.',
  },
  onboardingMode: { en: '🚀 Onboarding Mode (Seed Mock Data)', de: '🚀 Onboarding-Modus (Mock-Daten)', ja: '🚀 オンボーディングモード（モックデータ投入）', ko: '🚀 온보딩 모드 (모의 데이터 시드)' },
  seedMockDesc: {
    en: 'Populates the database with full partner accounts, programs, templates, action items, and status feeds. Perfect for walkthroughs and E2E validation.',
    de: 'Befüllt die Datenbank mit vollständigen Partnerkonten, Programmen, Vorlagen, Action Items und Statusfeeds. Ideal für Demos und E2E-Validierung.',
    ja: 'パートナーアカウント、プログラム、テンプレート、アクションアイテム、ステータスフィード一式をデータベースに投入します。ウォークスルーやE2E検証に最適です。',
    ko: '전체 파트너 계정, 프로그램, 템플릿, 액션 아이템, 상태 피드를 데이터베이스에 채웁니다. 둘러보기와 E2E 검증에 적합합니다.',
  },
  seedMockData: { en: 'Seed Mock Data', de: 'Mock-Daten einspielen', ja: 'モックデータを投入', ko: '모의 데이터 시드' },
  seedCoreHeading: { en: '🌱 Seed Core Data', de: '🌱 Kerndaten einspielen', ja: '🌱 コアデータを投入', ko: '🌱 핵심 데이터 시드' },
  seedCoreDesc: {
    en: 'Seeds baseline lookup data (Regions, Partner Types, Google LLC). Idempotent and non-destructive — safe to re-run; it never wipes existing data.',
    de: 'Spielt grundlegende Stammdaten ein (Regionen, Partnertypen, Google LLC). Idempotent und zerstörungsfrei – kann gefahrlos erneut ausgeführt werden und löscht nie vorhandene Daten.',
    ja: '基本のルックアップデータ（リージョン、パートナー種別、Google LLC）を投入します。冪等かつ非破壊的で、再実行しても安全です。既存データを消去しません。',
    ko: '기본 조회 데이터(지역, 파트너 유형, Google LLC)를 시드합니다. 멱등적이고 비파괴적이라 다시 실행해도 안전하며 기존 데이터를 지우지 않습니다.',
  },
  seedCoreData: { en: 'Seed Core Data', de: 'Kerndaten einspielen', ja: 'コアデータを投入', ko: '핵심 데이터 시드' },
  wipeAllHeading: { en: '🗑 Wipe All (Clean Slate)', de: '🗑 Alles löschen (Neustart)', ja: '🗑 全消去（クリーンスレート）', ko: '🗑 전체 삭제 (초기화)' },
  wipeAllDesc: {
    en: 'Completely clears all records from the database. Zero rows across all tables. Good for validation of absolute raw empty states.',
    de: 'Löscht alle Datensätze vollständig aus der Datenbank. Null Zeilen in allen Tabellen. Gut zur Prüfung komplett leerer Zustände.',
    ja: 'データベースの全レコードを完全に削除します。すべてのテーブルが0行になります。完全な空状態の検証に有用です。',
    ko: '데이터베이스의 모든 레코드를 완전히 삭제합니다. 모든 테이블이 0행이 됩니다. 완전한 빈 상태 검증에 유용합니다.',
  },
  wipeAllData: { en: 'Wipe All Data', de: 'Alle Daten löschen', ja: '全データを消去', ko: '모든 데이터 삭제' },
  simulateChatHeading: { en: 'Simulate Chat Integrations & Webhooks', de: 'Chat-Integrationen & Webhooks simulieren', ja: 'チャット連携とWebhookのシミュレーション', ko: '채팅 연동 및 웹훅 시뮬레이션' },
  adminHelpIntro1: { en: 'Use the following', de: 'Verwende die folgenden', ja: '外部アプリ（Google Chatなど）からのステータス更新やトリガーをテスト・シミュレートするには、次の', ko: '외부 애플리케이션(예: Google Chat)에서 들어오는 상태 업데이트와 트리거를 테스트하거나 시뮬레이션하려면 다음' },
  adminHelpIntro2: {
    en: 'commands to test or simulate incoming status updates and triggers from external applications like Google Chat (webhook receiver is at',
    de: 'Befehle, um eingehende Statusupdates und Trigger externer Anwendungen wie Google Chat zu testen oder zu simulieren (Webhook-Empfänger unter',
    ja: 'コマンドを使用してください（Webhookレシーバーは',
    ko: '명령을 사용하세요 (웹훅 수신기는',
  },
  curlExample1: { en: '1. Post a Status Update / Blocker trigger', de: '1. Statusupdate / Blocker-Trigger senden', ja: '1. ステータス更新 / ブロッカートリガーを送信', ko: '1. 상태 업데이트 / 블로커 트리거 게시' },
  curlExample2: { en: '2. Assign Owner / Action Item update', de: '2. Verantwortlichen zuweisen / Action Item aktualisieren', ja: '2. 担当者の割り当て / アクションアイテム更新', ko: '2. 담당자 할당 / 액션 아이템 업데이트' },

  // ---- project pages (new + detail) ----
  createNewProject: { en: 'Create New Program', de: 'Neues Programm erstellen', ja: '新規プログラムを作成', ko: '새 프로그램 만들기' },
  projectNamePlaceholder: { en: 'e.g. Ford F-150 AAOS Bring-up', de: 'z. B. Ford F-150 AAOS Bring-up', ja: '例: Ford F-150 AAOS Bring-up', ko: '예: Ford F-150 AAOS Bring-up' },
  partnerOemSupplier: { en: 'Partner (OEM / Supplier)', de: 'Partner (OEM / Zulieferer)', ja: 'パートナー（OEM / サプライヤー）', ko: '파트너 (OEM / 공급업체)' },
  selectAPartner: { en: 'Select a partner...', de: 'Partner wählen…', ja: 'パートナーを選択...', ko: '파트너 선택...' },
  projectTemplateDag: { en: 'Program Template (Critical Chain DAG)', de: 'Programmvorlage (Kritische-Kette-DAG)', ja: 'プログラムテンプレート（クリティカルチェーンDAG）', ko: '프로그램 템플릿 (크리티컬 체인 DAG)' },
  selectAPerson: { en: 'Select a person...', de: 'Person wählen…', ja: '担当者を選択...', ko: '담당자 선택...' },
  createProject: { en: 'Create Program', de: 'Programm erstellen', ja: 'プログラムを作成', ko: '프로그램 만들기' },
  backTo: { en: '← Back to {name}', de: '← Zurück zu {name}', ja: '← {name}に戻る', ko: '← {name}(으)로 돌아가기' },
  archivedTag: { en: '[Archived]', de: '[Archiviert]', ja: '[アーカイブ済み]', ko: '[보관됨]' },
  oemColon: { en: 'OEM:', de: 'OEM:', ja: 'OEM:', ko: 'OEM:' },
  programActivityIntro: {
    en: 'Needle and progress changes, phase updates, and ingested context for this program.',
    de: 'Nadel- und Fortschrittsänderungen, Phasen-Updates und erfasster Kontext dieses Programms.',
    ja: 'このプログラムのニードル・進捗の変化、フェーズ更新、取り込まれたコンテキスト。',
    ko: '이 프로그램의 니들·진행률 변경, 단계 업데이트, 수집된 컨텍스트.',
  },
  viaPartner: { en: 'via {p}', de: 'über {p}', ja: '{p} 経由', ko: '{p} 경유' },
  // Machine-vs-human provenance (design.md §8): LLM-written text carries this mark.
  aiLabel: { en: 'AI', de: 'KI', ja: 'AI', ko: 'AI' },
  aiTitle: {
    en: 'AI-generated — synthesized by Gemini from stored sources. Unmarked text was written by a person.',
    de: 'KI-generiert — von Gemini aus gespeicherten Quellen erstellt. Unmarkierter Text stammt von Menschen.',
    ja: 'AI生成 — Geminiが保存済みソースから合成。マークのないテキストは人が書いたものです。',
    ko: 'AI 생성 — Gemini가 저장된 소스에서 합성. 표시가 없는 텍스트는 사람이 작성한 것입니다.',
  },
  // ---- needle history popup ----
  close: { en: 'Close', de: 'Schließen', ja: '閉じる', ko: '닫기' },
  detail: { en: 'Detail', de: 'Details', ja: '詳細', ko: '상세' },
  byAuthor: { en: 'by {name}', de: 'von {name}', ja: '{name} による', ko: '{name} 작성' },
  needleDetailTitle: {
    en: 'Progress & health — full history',
    de: 'Fortschritt & Status — vollständiger Verlauf',
    ja: '進捗と健全性 — 全履歴',
    ko: '진행 및 상태 — 전체 기록',
  },
  relDetailTitle: {
    en: 'Relationship health — full history',
    de: 'Beziehungsstatus — vollständiger Verlauf',
    ja: '関係の健全性 — 全履歴',
    ko: '관계 상태 — 전체 기록',
  },
  discardUpdateConfirm: {
    en: 'Discard your unsaved update?',
    de: 'Nicht gespeicherte Änderungen verwerfen?',
    ja: '保存していない更新を破棄しますか？',
    ko: '저장하지 않은 업데이트를 취소하시겠습니까?',
  },

  // ---- section deep links (AnchorHeading) ----
  anchorLink: {
    en: 'Link to this section',
    de: 'Link zu diesem Abschnitt',
    ja: 'このセクションへのリンク',
    ko: '이 섹션으로 연결되는 링크',
  },
  briefingHeading: { en: 'Briefing', de: 'Briefing', ja: 'ブリーフィング', ko: '브리핑' },

  // ---- Critical Chain ledger (docs/CRITICAL_CHAIN_VIEW_PLAN.md) ----
  // Language rules: sentences not notation; every fact carries its judgment; visible
  // problems name computed reactions; people are named, never gendered (names over
  // pronouns also keeps de/ja/ko free of pronoun inflection).
  clBufferHeadline: {
    en: '{d} days of buffer between the estimated end on {date} and the SOP at the end of {month}.',
    de: '{d} Tage Puffer zwischen dem geschätzten Ende am {date} und dem SOP Ende {month}.',
    ja: '見込み完了日（{date}）とSOP（{month}末）の間に{d}日のバッファがあります。',
    ko: '예상 완료일({date})과 SOP({month} 말) 사이에 {d}일의 버퍼가 있습니다.',
  },
  clOvershootHeadline: {
    en: 'The estimated end on {date} lands {d} days after the SOP at the end of {month}.',
    de: 'Das geschätzte Ende am {date} liegt {d} Tage nach dem SOP Ende {month}.',
    ja: '見込み完了日（{date}）はSOP（{month}末）を{d}日超過しています。',
    ko: '예상 완료일({date})이 SOP({month} 말)보다 {d}일 늦습니다.',
  },
  clNoSop: {
    en: 'This program has no SOP date, so the buffer cannot be computed. Set the SOP in the program header.',
    de: 'Dieses Programm hat keinen SOP-Termin, daher kann der Puffer nicht berechnet werden. SOP im Programmkopf setzen.',
    ja: 'この プログラムにはSOPが未設定のため、バッファを計算できません。プログラムヘッダーでSOPを設定してください。',
    ko: '이 프로그램에는 SOP 날짜가 없어 버퍼를 계산할 수 없습니다. 프로그램 헤더에서 SOP를 설정하세요.',
  },
  clGuidelineTitle: {
    en: '{b} days of buffer against {rem} days of remaining chain work — a comfortable buffer for that much work is about {g} days.',
    de: '{b} Tage Puffer bei {rem} Tagen verbleibender Kettenarbeit — ein komfortabler Puffer wären etwa {g} Tage.',
    ja: '残り{rem}日のチェーン作業に対しバッファは{b}日 — 十分なバッファの目安は約{g}日です。',
    ko: '남은 체인 작업 {rem}일에 대해 버퍼 {b}일 — 여유 있는 버퍼는 약 {g}일입니다.',
  },
  // Judgment sentence openers, by register (the status IS this sentence).
  clJudgeNone: {
    en: 'Nothing needs to change today',
    de: 'Heute muss nichts geändert werden',
    ja: '今日は何も変更する必要はありません',
    ko: '오늘은 아무것도 바꿀 필요가 없습니다',
  },
  // These three share ONE <h3>, beside "Where the buffer went". A heading states a
  // thing; it needs no colon to announce that content follows, and the terminal stop
  // goes with it so all the headings in that grid read the same way.
  clJudgePlan: {
    en: 'Next step',
    de: 'Nächster Schritt',
    ja: '次のステップ',
    ko: '다음 단계',
  },
  clJudgeAct: {
    en: 'Time to act, in order of least disruption',
    de: 'Zeit zu handeln, in der Reihenfolge des geringsten Eingriffs',
    ja: '対応が必要です。影響の小さい順',
    ko: '조치가 필요합니다. 영향이 작은 순서로',
  },
  clLeverHandoff: {
    en: 'Agree the {from} → {to} handoff now, so the phase starts the day it can.',
    de: 'Die Übergabe {from} → {to} jetzt vereinbaren, damit die Phase am erstmöglichen Tag startet.',
    ja: '{from}→{to}の引き継ぎを今のうちに合意し、開始可能日に即着手できるようにしましょう。',
    ko: '{from} → {to} 인수인계를 지금 합의해 시작 가능한 날 바로 착수하게 하세요.',
  },
  // Overruns against a phase's OWN estimate. "Where the buffer went" has always
  // reported these as history; nothing ever asked anyone to DO something about
  // them. The measure is a percentage rather than days — see SEVERE_OVERRUN_PCT
  // in lib/chainLedger for why, and for the threshold that picks clOverrunSevere
  // over clOverrunActive.
  clOverrunSevere: {
    en: '{phase} is {pct}% past its {p}-day estimate, with {r} days of work still left. Exploit the constraint: root-cause the overrun and clear what is holding the phase up, or re-estimate it if the plan was optimistic.',
    de: '{phase} liegt {pct} % über der {p}-Tage-Schätzung, bei {r} Tagen Restarbeit. Den Engpass ausschöpfen: Ursache der Überschreitung finden und die Blockade beseitigen — oder die Phase neu schätzen, falls der Plan zu optimistisch war.',
    ja: '{phase}は{p}日の見積もりを{pct}%超過し、残作業は{r}日です。制約を徹底活用しましょう — 超過の原因を突き止めて滞りを解消するか、計画が楽観的だったなら見積もりを修正してください。',
    ko: '{phase}은(는) {p}일 견적을 {pct}% 초과했고 남은 작업은 {r}일입니다. 제약을 최대한 활용하세요 — 초과의 근본 원인을 찾아 막고 있는 것을 해결하거나, 계획이 낙관적이었다면 다시 견적하세요.',
  },
  clOverrunActive: {
    en: '{phase} is tracking {d} days ({pct}%) past its {p}-day estimate. Find the cause while it is still small — clear it, or re-estimate the phase.',
    de: '{phase} läuft {d} Tage ({pct} %) über die {p}-Tage-Schätzung. Die Ursache finden, solange sie klein ist — beseitigen oder die Phase neu schätzen.',
    ja: '{phase}は{p}日の見積もりを{d}日（{pct}%）超過して推移しています。小さいうちに原因を特定し、解消するか見積もりを修正しましょう。',
    ko: '{phase}은(는) {p}일 견적보다 {d}일({pct}%) 초과해 진행 중입니다. 작을 때 원인을 찾아 해결하거나 단계를 다시 견적하세요.',
  },
  clOverrunSunkOne: {
    en: '{phases} finished {d} days ({pct}%) past its estimate. That time is spent — what it leaves open is whether the estimates still ahead are optimistic too.',
    de: '{phases} endete {d} Tage ({pct} %) über der Schätzung. Diese Zeit ist verbraucht — offen bleibt, ob auch die noch bevorstehenden Schätzungen zu optimistisch sind.',
    ja: '{phases}は見積もりを{d}日（{pct}%）超過して完了しました。その時間は戻りません — 残るのは、この先の見積もりも楽観的ではないかという問いです。',
    ko: '{phases}은(는) 견적을 {d}일({pct}%) 초과해 완료됐습니다. 그 시간은 이미 쓰였고, 남는 질문은 앞으로의 견적도 낙관적이지 않은가입니다.',
  },
  clOverrunSunk: {
    en: 'Finished phases ran past their estimates: {phases}. Repeated overruns are an estimating problem rather than bad luck — re-estimate the phases still ahead.',
    de: 'Abgeschlossene Phasen liefen über ihre Schätzungen: {phases}. Wiederholte Überschreitungen sind ein Schätzproblem, kein Pech — die noch bevorstehenden Phasen neu schätzen.',
    ja: '完了フェーズが見積もりを超過しました: {phases}。繰り返す超過は不運ではなく見積もりの問題です — この先のフェーズを見積もり直しましょう。',
    ko: '완료된 단계들이 견적을 넘겼습니다: {phases}. 반복되는 초과는 운이 아니라 견적의 문제입니다 — 앞으로의 단계를 다시 견적하세요.',
  },
  clOverrunSunkItem: {
    en: '{phase} (+{pct}%)', de: '{phase} (+{pct} %)', ja: '{phase}（+{pct}%）', ko: '{phase}(+{pct}%)',
  },
  // The same fact raised to PROGRAM level — the header line, above the fold, where
  // it is read before anyone scrolls into the chain section. Label + one-line fact
  // + the reaction (design.md §7), so the sentence still reads if the label is
  // scanned past.
  clFocusLabel: {
    en: 'Immediate focus', de: 'Sofortiger Fokus', ja: '最優先事項', ko: '즉시 집중',
  },
  clFocusPhase: {
    en: '{phase} is {pct}% past its estimate with {r} days of work still left.',
    de: '{phase} liegt {pct} % über der Schätzung, bei {r} Tagen Restarbeit.',
    ja: '{phase}は見積もりを{pct}%超過し、残作業は{r}日です。',
    ko: '{phase}은(는) 견적을 {pct}% 초과했고 남은 작업은 {r}일입니다.',
  },
  clFocusAlsoOne: {
    en: '1 other phase is past its estimate too.',
    de: '1 weitere Phase liegt ebenfalls über ihrer Schätzung.',
    ja: '他に1件のフェーズも見積もりを超過しています。',
    ko: '다른 단계 1개도 견적을 초과했습니다.',
  },
  clFocusAlso: {
    en: '{n} other phases are past their estimates too.',
    de: '{n} weitere Phasen liegen ebenfalls über ihren Schätzungen.',
    ja: '他に{n}件のフェーズも見積もりを超過しています。',
    ko: '다른 단계 {n}개도 견적을 초과했습니다.',
  },
  clFocusExploit: {
    en: 'Exploit the constraint: clear what is holding it up before starting anything new.',
    de: 'Den Engpass ausschöpfen: die Blockade beseitigen, bevor Neues begonnen wird.',
    ja: '制約を徹底活用しましょう — 新しい作業を始める前に、滞りを解消してください。',
    ko: '제약을 최대한 활용하세요 — 새 작업을 시작하기 전에 막고 있는 것을 해결하세요.',
  },
  clLeverDeclare: {
    en: 'Declare the program Concerned and propose moving SOP to {month}',
    de: 'Das Programm auf „Concerned“ setzen und eine SOP-Verschiebung auf {month} vorschlagen',
    ja: 'プログラムを「Concerned」にし、SOPの{month}への変更を提案する',
    ko: '프로그램을 "Concerned"로 선언하고 SOP를 {month}(으)로 옮기는 안을 제안하기',
  },
  clUnitsDelayed: {
    en: '≈{units} of the {volume} first-year units would arrive later.',
    de: '≈{units} der {volume} Einheiten im ersten Jahr kämen später.',
    ja: '初年度{volume}台のうち約{units}台が後ろ倒しになります。',
    ko: '첫해 {volume}대 중 약 {units}대가 늦어집니다.',
  },
  clRebaseline: {
    en: 'The longest remaining work no longer runs along the planned chain. Review the phase plan?',
    de: 'Die längste verbleibende Arbeit verläuft nicht mehr entlang der geplanten Kette. Phasenplan prüfen?',
    ja: '残作業の最長経路が計画上のチェーンから外れています。フェーズ計画を見直しますか？',
    ko: '남은 작업의 최장 경로가 계획된 체인을 벗어났습니다. 단계 계획을 검토할까요?',
  },
  // Schedule chart
  clSchedule: { en: 'Schedule', de: 'Zeitplan', ja: 'スケジュール', ko: '일정' },
  clZoomLabel: { en: 'Zoom the timeline', de: 'Zeitachse zoomen', ja: 'タイムラインをズーム', ko: '타임라인 확대' },
  clZoomFit: { en: 'Fit', de: 'Alles', ja: '全体', ko: '전체' },
  clZoomTwoWeeks: { en: '2 wk', de: '2 Wo', ja: '2週', ko: '2주' },
  clZoomIn: { en: 'Zoom in', de: 'Vergrößern', ja: '拡大', ko: '확대' },
  clZoomOut: { en: 'Zoom out', de: 'Verkleinern', ja: '縮小', ko: '축소' },
  clKeyTitle: { en: 'How to read the schedule', de: 'So liest du den Zeitplan', ja: 'スケジュールの読み方', ko: '일정 읽는 법' },
  clKeyOnPlan: {
    en: 'A solid bar is work that happened — soft once the phase is done, bold on the phase running now.',
    de: 'Ein ausgefüllter Balken ist geleistete Arbeit — blass wenn die Phase fertig ist, kräftig bei der laufenden Phase.',
    ja: '塗りつぶしのバーは実際に行われた作業。完了したフェーズは淡く、進行中フェーズは濃く表示。',
    ko: '채워진 막대는 실제로 진행한 작업 — 완료된 단계는 옅게, 진행 중 단계는 진하게.',
  },
  clKeyOver: {
    en: 'A red tail past the tick is days the phase ran over its own estimate, counted to the day.',
    de: 'Ein roter Fortsatz hinter dem Strich sind Tage über der eigenen Schätzung der Phase, tagesgenau.',
    ja: '目盛りを超える赤い延長は、フェーズが自身の見積もりを超過した日数を日単位で示します。',
    ko: '눈금을 넘는 빨간 꼬리는 단계가 자체 추정을 초과한 일수로, 일 단위로 셉니다.',
  },
  clKeyEarly: {
    en: 'A dashed green ghost back to the tick is days the phase handed back to the buffer.',
    de: 'Ein gestrichelter grüner Umriss zurück zum Strich sind Tage, die die Phase an den Puffer zurückgegeben hat.',
    ja: '目盛りまで戻る緑の破線は、フェーズがバッファに返却した日数です。',
    ko: '눈금까지 이어지는 초록 점선은 단계가 버퍼에 반환한 일수입니다.',
  },
  clKeyIdle: {
    en: 'Amber dashes mark idle days between phases — dead air the program pays for.',
    de: 'Bernsteinfarbene Striche markieren Leerlauftage zwischen Phasen — totes Warten, das das Programm bezahlt.',
    ja: '琥珀色の破線はフェーズ間の待機日 — プログラムが負担する空白時間です。',
    ko: '호박색 점선은 단계 사이의 대기 일수 — 프로그램이 부담하는 공백입니다.',
  },
  clKeyForecast: {
    en: 'A dashed grey outline is forecast, or not-yet-started, work; dashed red past the tick is forecast to go over.',
    de: 'Ein gestrichelter grauer Umriss ist prognostizierte oder noch nicht begonnene Arbeit; gestricheltes Rot hinter dem Strich ist die prognostizierte Überschreitung.',
    ja: '灰色の破線の枠は予測または未着手の作業。目盛りを超える赤い破線は超過の予測です。',
    ko: '회색 점선 윤곽은 예측이거나 아직 시작하지 않은 작업이며, 눈금을 넘는 빨간 점선은 초과 예측입니다.',
  },
  clKeyTick: {
    en: 'The tick shows where the plan said the phase would end — every tail is measured from it, and the number beside a tail says how many days.',
    de: 'Der Strich markiert das geplante Phasenende — jeder Fortsatz wird von dort gemessen, und die Zahl daneben nennt die Tage.',
    ja: '目盛りは計画上のフェーズ終了点です。すべての延長はここから測られ、隣の数字が日数を示します。',
    ko: '눈금은 계획된 단계 종료 지점입니다. 모든 꼬리는 여기서부터 재며, 옆의 숫자가 일수를 나타냅니다.',
  },
  clKeyRing: {
    en: 'The ring marks the phase gating the SOP.',
    de: 'Der Ring markiert die Phase, die den SOP bestimmt.',
    ja: 'リングはSOPを左右するフェーズを示します。',
    ko: '링은 SOP를 좌우하는 단계를 표시합니다.',
  },
  clKeyBufferLane: {
    en: 'The flow below splits the program buffer each day: green is still in hand, red is spent. Dashed is the forecast; below the 0% line the buffer is gone and the days are past the SOP.',
    de: 'Der Verlauf darunter teilt den Programmpuffer täglich auf: grün ist verfügbar, rot verbraucht. Gestrichelt ist die Prognose; unter der 0-%-Linie ist der Puffer aufgebraucht und die Tage liegen nach dem SOP.',
    ja: '下のフローは各日のプログラムバッファを分けます。緑は手元に残る分、赤は消費した分です。破線は予測で、0%線より下はバッファが尽きてSOPを超過した日数です。',
    ko: '아래 흐름은 매일의 프로그램 버퍼를 나눕니다. 초록은 남은 버퍼, 빨강은 소모한 버퍼입니다. 점선은 예측이며, 0% 선 아래는 버퍼가 소진되어 SOP를 넘긴 일수입니다.',
  },
  clDaysEarly: { en: '{d} days early', de: '{d} Tage früher', ja: '{d}日早く完了', ko: '{d}일 일찍 완료' },
  clOneDayEarly: { en: '1 day early', de: '1 Tag früher', ja: '1日早く完了', ko: '1일 일찍 완료' },
  clDaysOverPlan: { en: '{d} days over plan', de: '{d} Tage über Plan', ja: '計画超過{d}日', ko: '계획 초과 {d}일' },
  clOneDayOverPlan: { en: '1 day over plan', de: '1 Tag über Plan', ja: '計画超過1日', ko: '계획 초과 1일' },
  clSatIdle: { en: 'sat idle {d} days', de: '{d} Tage Leerlauf', ja: '{d}日間待機', ko: '{d}일간 대기' },
  // The docked day strip (issue #161 step 4/4) — replaces the per-row hover card below.
  // Its per-phase lines reuse the clRow*/clWorkLeft* keys verbatim (a phase's own
  // story does not change because a day strip asks about it instead of a hover); these
  // four are the only new copy the strip needed: its title, the "today" marker, the
  // day-index annotation, and the empty-day sentence.
  cdTitle: { en: 'day summary', de: 'Tageszusammenfassung', ja: '日次サマリー', ko: '일별 요약' },
  cdToday: { en: '(today)', de: '(heute)', ja: '（今日）', ko: '(오늘)' },
  cdDayOf: { en: 'day {i} of {n}', de: 'Tag {i} von {n}', ja: '{n}日中{i}日目', ko: '{n}일 중 {i}일째' },
  cdNothing: {
    en: 'Nothing in flight — no phase, credit, or idle day here.',
    de: 'Nichts in Arbeit — keine Phase, keine Gutschrift, kein Leerlauftag hier.',
    ja: '進行中の作業なし — フェーズ、クレジット、待機日のいずれもありません。',
    ko: '진행 중인 것 없음 — 이 날에는 단계도, 크레딧도, 대기일도 없습니다.',
  },
  // Schedule-row hover card: what this phase did to the buffer, in one line each.
  clRowRan: { en: 'Ran {a} – {b}', de: 'Lief {a} – {b}', ja: '実績 {a}〜{b}', ko: '진행 {a} – {b}' },
  clRowRunning: { en: 'Started {a}, forecast to {b}', de: 'Start {a}, Prognose bis {b}', ja: '{a}開始・{b}完了見込み', ko: '{a} 시작 · {b} 완료 예상' },
  clRowPlannedWindow: { en: 'Projected {a} – {b}', de: 'Geplant {a} – {b}', ja: '予定 {a}〜{b}', ko: '예정 {a} – {b}' },
  clRowOnPlan: { en: 'Finished on plan — no buffer moved.', de: 'Planmäßig beendet — kein Puffer bewegt.', ja: '計画どおり完了 — バッファの増減なし。', ko: '계획대로 완료 — 버퍼 변동 없음.' },
  clRowSpent: { en: 'Spent {d} days of buffer.', de: '{d} Tage Puffer verbraucht.', ja: 'バッファを{d}日消費。', ko: '버퍼 {d}일 소모.' },
  clRowSpentOne: { en: 'Spent 1 day of buffer.', de: '1 Tag Puffer verbraucht.', ja: 'バッファを1日消費。', ko: '버퍼 1일 소모.' },
  clRowGave: { en: 'Handed {d} days back to the buffer.', de: '{d} Tage an den Puffer zurückgegeben.', ja: 'バッファに{d}日返却。', ko: '버퍼에 {d}일 반환.' },
  clRowGaveOne: { en: 'Handed 1 day back to the buffer.', de: '1 Tag an den Puffer zurückgegeben.', ja: 'バッファに1日返却。', ko: '버퍼에 1일 반환.' },
  clRowNoClaim: { en: 'Not started — it has not moved the buffer yet.', de: 'Nicht begonnen — noch kein Puffereinfluss.', ja: '未着手 — バッファへの影響はまだありません。', ko: '시작 전 — 아직 버퍼에 영향 없음.' },
  clWorkLeftOnPace: {
    en: '≈{d} days of work left · on pace with its plan',
    de: '≈{d} Tage Arbeit übrig · im Plan',
    ja: '残り約{d}日 · 計画どおり',
    ko: '남은 작업 약 {d}일 · 계획대로 진행 중',
  },
  clWorkLeftOnPaceOne: {
    en: '≈1 day of work left · on pace with its plan',
    de: '≈1 Tag Arbeit übrig · im Plan',
    ja: '残り約1日 · 計画どおり',
    ko: '남은 작업 약 1일 · 계획대로 진행 중',
  },
  clWorkLeftOver: {
    en: '≈{d} days of work left · forecast ~{o} days over plan',
    de: '≈{d} Tage Arbeit übrig · Prognose ~{o} Tage über Plan',
    ja: '残り約{d}日 · 予測で計画超過約{o}日',
    ko: '남은 작업 약 {d}일 · 예측상 계획 초과 약 {o}일',
  },
  clWorkLeftOverOne: {
    en: '≈1 day of work left · forecast ~{o} days over plan',
    de: '≈1 Tag Arbeit übrig · Prognose ~{o} Tage über Plan',
    ja: '残り約1日 · 予測で計画超過約{o}日',
    ko: '남은 작업 약 1일 · 예측상 계획 초과 약 {o}일',
  },
  // "buffer" is THE word for this quantity across the app (headline, row cards, the
  // ecosystem tile). "room"/"Spielraum"/"余裕"/"여유" were synonyms for the same thing
  // and a synonym reads as a different thing — matched to the canonical term.
  clDaysOfBuffer: { en: '{d} days of buffer', de: '{d} Tage Puffer', ja: 'バッファ{d}日', ko: '버퍼 {d}일' },
  clSopLabel: { en: 'SOP · end of {month}', de: 'SOP · Ende {month}', ja: 'SOP · {month}末', ko: 'SOP · {month} 말' },
  clTodayLabel: { en: 'today · {date}', de: 'heute · {date}', ja: '今日 · {date}', ko: '오늘 · {date}' },
  // Compact labels on the schedule's rows (issues #75, #161).
  clIdleDays: { en: '{d}d idle', de: '{d}T Leerlauf', ja: '待機{d}日', ko: '{d}일 대기' },
  // The variance beside a bar's own tail: days past the plan tick, or days handed back.
  // `{d}` is always a POSITIVE count and the sign is in the copy, so the two never read
  // as one string with a sign glued on — and the minus is a real minus (U+2212), the
  // same call the flow's negative axis makes: a hyphen there also means "range".
  clBarOver: { en: '+{d}d', de: '+{d} T', ja: '+{d}日', ko: '+{d}일' },
  clBarUnder: { en: '−{d}d', de: '−{d} T', ja: '−{d}日', ko: '−{d}일' },
  // Label under an axis-break glyph: how much empty time the seam compresses.
  clAxisBreak: { en: '{d} days', de: '{d} Tage', ja: '{d}日', ko: '{d}일' },
  // The two-tone buffer flow (issue #161). It replaced a stepped lane whose labels
  // named every MOVE ({d}d buffer, {d}d, buffer on hand); these name the two BANDS
  // and the frame around them, because the flow's reading is one boundary, not ten
  // steps. `clBufferGuideline` survives the swap: decision 7 keeps the reserve as a
  // marker at today, and a marker still needs its label.
  clFlowTitle: {
    en: 'buffer left vs spent', de: 'Puffer übrig vs. verbraucht',
    ja: 'バッファ残 vs 消費', ko: '버퍼 잔여 vs 소모',
  },
  clFlowPct: { en: '{p}%', de: '{p} %', ja: '{p}%', ko: '{p}%' },
  clFlowLeft: { en: '{p}% left · {d}d', de: '{p} % übrig · {d}T', ja: '残り{p}% · {d}日', ko: '{p}% 잔여 · {d}일' },
  clFlowSpent: { en: '{p}% spent', de: '{p} % verbraucht', ja: '{p}%消費', ko: '{p}% 소모' },
  // Below zero the axis is labelled in what it MEANS — the buffer is gone, so the
  // number people act on is days past the SOP, never "−{d}d of buffer left".
  clFlowPastSop: {
    en: '{p}% · {d}d past SOP', de: '{p} % · {d}T nach SOP',
    ja: '{p}% · SOPを{d}日超過', ko: '{p}% · SOP {d}일 초과',
  },
  clFlowBlown: { en: 'buffer gone · {date}', de: 'Puffer aufgebraucht · {date}', ja: 'バッファ枯渇 · {date}', ko: '버퍼 소진 · {date}' },
  clFlowNoBase: {
    en: 'No buffer to divide: this program started with none.',
    de: 'Kein Puffer zum Aufteilen: dieses Programm startete ohne.',
    ja: '分配できるバッファがありません。このプログラムは最初からゼロです。',
    ko: '나눌 버퍼가 없습니다: 이 프로그램은 처음부터 버퍼가 없었습니다.',
  },
  clBufferGuideline: { en: '{d}d reserve', de: '{d}T Reserve', ja: '予備{d}日', ko: '예비 {d}일' },
  // The reserve marker off the top of the frame (autoknow-4dr.2) — the common case,
  // since the reserve is remainingTotal/2 and any program with more remaining work
  // than B₀ pushes past 100% of it. Says so explicitly rather than a bare number
  // sitting at the frame's ceiling, which would read as the reserve itself, not a
  // marker of how far above the visible frame it actually sits.
  clBufferGuidelineOff: {
    en: '{d}d reserve — above frame', de: '{d}T Reserve — über dem Rahmen',
    ja: '予備{d}日 — 枠外', ko: '예비 {d}일 — 프레임 밖',
  },
  // Waterfall
  clWhereBufferWent: { en: 'Where the buffer went', de: 'Wohin der Puffer ging', ja: 'バッファの行方', ko: '버퍼가 쓰인 곳' },
  clCostDays: { en: 'cost {d} days', de: 'kostete {d} Tage', ja: '{d}日を消費', ko: '{d}일 소모' },
  clCostOneDay: { en: 'cost 1 day', de: 'kostete 1 Tag', ja: '1日を消費', ko: '1일 소모' },
  clGaveBackDays: { en: 'gave back {d} days', de: 'gab {d} Tage zurück', ja: '{d}日を返上', ko: '{d}일 회복' },
  clGaveBackOneDay: { en: 'gave back 1 day', de: 'gab 1 Tag zurück', ja: '1日を返上', ko: '1일 회복' },
  clIdleBefore: { en: 'Idle before {phase}', de: 'Leerlauf vor {phase}', ja: '{phase}前の待機', ko: '{phase} 전 대기' },
  clUnattributed: { en: 'Unattributed', de: 'Nicht zugeordnet', ja: '内訳不明', ko: '미분류' },
  clEvidencePlanTook: {
    en: 'planned {p} days, took {a} ({from} → {to})',
    de: 'geplant {p} Tage, gebraucht {a} ({from} → {to})',
    ja: '計画{p}日、実績{a}日（{from}→{to}）',
    ko: '계획 {p}일, 실제 {a}일 ({from} → {to})',
  },
  clEvidenceSunk: {
    en: 'Already spent — shown so the next plan is realistic.',
    de: 'Bereits verbraucht — angezeigt, damit der nächste Plan realistisch wird.',
    ja: 'すでに消費済み — 次の計画を現実的にするために表示しています。',
    ko: '이미 소모됨 — 다음 계획을 현실적으로 만들기 위해 표시합니다.',
  },
  clEvidenceContended: {
    en: '{names} had work in other programs while this ran.',
    de: '{names} hatte währenddessen Arbeit in anderen Programmen.',
    ja: 'この間、{names}は他プログラムの作業も抱えていました。',
    ko: '이 기간 동안 {names}은(는) 다른 프로그램 작업도 맡고 있었습니다.',
  },
  clEvidenceGap: {
    en: '{from} finished {d1}; {to} did not start until {d2}.',
    de: '{from} endete am {d1}; {to} begann erst am {d2}.',
    ja: '{from}は{d1}に完了、{to}の開始は{d2}でした。',
    ko: '{from}은(는) {d1}에 끝났지만 {to}은(는) {d2}에야 시작했습니다.',
  },
  clEvidenceGapOngoing: {
    en: '{from} finished {d1}; the next phase has not started.',
    de: '{from} endete am {d1}; die nächste Phase hat noch nicht begonnen.',
    ja: '{from}は{d1}に完了しましたが、次のフェーズは未着手です。',
    ko: '{from}은(는) {d1}에 끝났지만 다음 단계가 아직 시작되지 않았습니다.',
  },
  clEvidenceGapAvoid: {
    en: 'Avoidable next time — the next handoff can be agreed before the phase finishes.',
    de: 'Beim nächsten Mal vermeidbar — die nächste Übergabe lässt sich vor Phasenende vereinbaren.',
    ja: '次回は回避可能 — 次の引き継ぎはフェーズ完了前に合意できます。',
    ko: '다음에는 피할 수 있습니다 — 다음 인수인계는 단계가 끝나기 전에 합의할 수 있습니다.',
  },
  clEvidenceForecast: {
    en: 'Forecast, not yet spent: {e} days elapsed and ≈{r} left against {p} planned.',
    de: 'Prognose, noch nicht verbraucht: {e} Tage vergangen, ≈{r} übrig, bei {p} geplant.',
    ja: '未確定の予測: 経過{e}日+残り約{r}日、計画は{p}日。',
    ko: '아직 쓰지 않은 예측: 경과 {e}일 + 남은 약 {r}일, 계획은 {p}일.',
  },
  clEvidenceUnattributed: {
    en: 'Plan edits and rounding — the books are not forced to balance.',
    de: 'Plan-Änderungen und Rundung — die Bilanz wird nicht erzwungen.',
    ja: '計画変更と丸め — 帳尻合わせは行いません。',
    ko: '계획 수정과 반올림 — 억지로 수지를 맞추지 않습니다.',
  },
  clNetUsed: {
    en: '{used} days used of the original {b0} since program start',
    de: 'seit Programmstart {used} von ursprünglich {b0} Tagen verbraucht',
    ja: '開始時{b0}日のうち{used}日を使用',
    ko: '시작 시 {b0}일 중 {used}일 사용',
  },
  clNetGained: {
    en: '{g} days gained vs. the original {b0} since program start',
    de: 'seit Programmstart {g} Tage gegenüber ursprünglich {b0} gewonnen',
    ja: '開始時{b0}日に対し{g}日増加',
    ko: '시작 시 {b0}일 대비 {g}일 증가',
  },
  // Who is oversubscribed
  clOwnerLoad: {
    en: '{owner} owns this program and is also on {n} active phases elsewhere: {items}. Not proven to gate this chain, but worth knowing before asking for more of their time.',
    de: '{owner} verantwortet dieses Programm und ist zusätzlich in {n} aktiven Phasen anderswo tätig: {items}. Nicht nachweislich kettenbestimmend, aber gut zu wissen, bevor mehr Zeit angefragt wird.',
    ja: '{owner}は本プログラムのオーナーであり、他にも{n}件の進行中フェーズを担当しています: {items}。本チェーンを律速している証拠はありませんが、追加の時間を依頼する前に把握しておく価値があります。',
    ko: '{owner}은(는) 이 프로그램의 오너이며 다른 곳에서도 진행 중인 단계 {n}개를 맡고 있습니다: {items}. 이 체인을 좌우한다는 증거는 없지만, 시간을 더 요청하기 전에 알아둘 만합니다.',
  },
  clOwnerLoadOne: {
    en: '{owner} owns this program and is also on 1 active phase elsewhere: {items}. Not proven to gate this chain, but worth knowing before asking for more of their time.',
    de: '{owner} verantwortet dieses Programm und ist zusätzlich in 1 aktiven Phase anderswo tätig: {items}. Nicht nachweislich kettenbestimmend, aber gut zu wissen, bevor mehr Zeit angefragt wird.',
    ja: '{owner}は本プログラムのオーナーであり、他にも進行中フェーズを1件担当しています: {items}。本チェーンを律速している証拠はありませんが、追加の時間を依頼する前に把握しておく価値があります。',
    ko: '{owner}은(는) 이 프로그램의 오너이며 다른 곳에서도 진행 중인 단계 1개를 맡고 있습니다: {items}. 이 체인을 좌우한다는 증거는 없지만, 시간을 더 요청하기 전에 알아둘 만합니다.',
  },
  // Two openers: the phase is visibly overrunning, or it simply has a contended
  // resource on it. Claiming "while X is overrunning" on a phase that is on plan
  // (or hasn't started) would be false — see the language rules' judgment test.
  clOversubOverrun: {
    en: '{name} is active in {n} other programs while {phase} is overrunning.',
    de: '{name} ist in {n} weiteren Programmen aktiv, während {phase} über Plan läuft.',
    ja: '{phase}が計画を超過している間、{name}は他に{n}件のプログラムでも稼働しています。',
    ko: '{phase}이(가) 계획을 초과하는 동안 {name}은(는) 다른 프로그램 {n}개에서도 일하고 있습니다.',
  },
  clOversubOverrunOne: {
    en: '{name} is active in 1 other program while {phase} is overrunning.',
    de: '{name} ist in 1 weiteren Programm aktiv, während {phase} über Plan läuft.',
    ja: '{phase}が計画を超過している間、{name}は他に1件のプログラムでも稼働しています。',
    ko: '{phase}이(가) 계획을 초과하는 동안 {name}은(는) 다른 프로그램 1개에서도 일하고 있습니다.',
  },
  clOversubNeutral: {
    en: '{name} is on {phase} and is also active in {n} other programs.',
    de: '{name} arbeitet an {phase} und ist außerdem in {n} weiteren Programmen aktiv.',
    ja: '{name}は{phase}を担当し、他に{n}件のプログラムでも稼働しています。',
    ko: '{name}은(는) {phase}을(를) 맡고 있으며 다른 프로그램 {n}개에서도 일하고 있습니다.',
  },
  clOversubNeutralOne: {
    en: '{name} is on {phase} and is also active in 1 other program.',
    de: '{name} arbeitet an {phase} und ist außerdem in 1 weiteren Programm aktiv.',
    ja: '{name}は{phase}を担当し、他に1件のプログラムでも稼働しています。',
    ko: '{name}은(는) {phase}을(를) 맡고 있으며 다른 프로그램 1개에서도 일하고 있습니다.',
  },
  clOversubMoves: {
    en: 'If {phase} needs more time from {name}: {programs} can afford to give some back.',
    de: 'Falls {phase} mehr Zeit von {name} braucht: {programs} können etwas abgeben.',
    ja: '{phase}に{name}の時間がもっと必要なら、{programs}から融通できます。',
    ko: '{phase}에 {name}의 시간이 더 필요하면 {programs}에서 돌려받을 수 있습니다.',
  },
  clOversubTight: {
    en: '{programs} has no buffer to give.',
    de: '{programs} hat keinen Puffer abzugeben.',
    ja: '{programs}には融通できるバッファがありません。',
    ko: '{programs}에는 내어줄 버퍼가 없습니다.',
  },
  clProgWithBuffer: {
    en: '{name} ({d} days of buffer)',
    de: '{name} ({d} Tage Puffer)',
    ja: '{name}（バッファ{d}日）',
    ko: '{name}(버퍼 {d}일)',
  },
  clUpNextLine: {
    en: 'Up next: {phase} — {names}, also active in {n} other programs.',
    de: 'Als Nächstes: {phase} — {names}, außerdem in {n} weiteren Programmen aktiv.',
    ja: '次は{phase} — 担当は{names}（他に{n}件のプログラムでも活動中）。',
    ko: '다음은 {phase} — {names}, 다른 프로그램 {n}개에서도 활동 중.',
  },
  clUpNextConfirm: {
    en: 'Worth confirming staffing before {current} finishes, so the phase starts the day it can.',
    de: 'Vor dem Ende von {current} die Besetzung klären, damit die Phase am erstmöglichen Tag startet.',
    ja: '{current}が終わる前に体制を確認し、開始可能日に即着手できるようにしましょう。',
    ko: '{current}이(가) 끝나기 전에 인력 배치를 확인해 시작 가능한 날 바로 착수하게 하세요.',
  },
  // Ecosystem: busiest people and partners
  clBusiest: { en: 'Possible Resource Constraints', de: 'Mögliche Ressourcenengpässe', ja: 'リソース制約の可能性', ko: '잠재적 리소스 제약' },
  clBusiestIntro: {
    en: 'The people and partners several programs depend on at once — one calendar driving many SOPs.',
    de: 'Personen und Partner, von denen mehrere Programme gleichzeitig abhängen — ein Kalender bestimmt viele SOPs.',
    ja: '複数のプログラムが同時に依存する人とパートナー — 一つのカレンダーが多くのSOPを左右します。',
    ko: '여러 프로그램이 동시에 의존하는 사람과 파트너 — 하나의 일정이 여러 SOP를 좌우합니다.',
  },
  clWho: { en: 'Who', de: 'Wer', ja: '誰', ko: '누구' },
  clGatingSop: { en: 'Currently gating the SOP of', de: 'Bestimmt derzeit den SOP von', ja: '現在SOPを左右', ko: '현재 SOP를 좌우' },
  clAlsoActiveIn: { en: 'Also active in', de: 'Außerdem aktiv in', ja: '他の活動', ko: '기타 활동' },
  clBufferChange: {
    en: "Buffer change, last 4 weeks · what's at stake",
    de: 'Pufferänderung, letzte 4 Wochen · was auf dem Spiel steht',
    ja: '直近4週のバッファ変化 · 影響規模',
    ko: '최근 4주 버퍼 변화 · 걸린 규모',
  },
  clLostDays: { en: '{name} lost {d} days', de: '{name} verlor {d} Tage', ja: '{name}は{d}日減', ko: '{name} {d}일 감소' },
  clNoChangeCell: {
    en: 'no change — nothing to do here',
    de: 'keine Änderung — hier ist nichts zu tun',
    ja: '変化なし — 対応不要',
    ko: '변화 없음 — 조치 불필요',
  },
  clUnitsIn: { en: '{units} units in {year}', de: '{units} Einheiten in {year}', ja: '{year}に{units}台', ko: '{year}에 {units}대' },
  clNMore: { en: '{n} more', de: '{n} weitere', ja: '他{n}件', ko: '외 {n}건' },
  clConsiderPerson: {
    en: "Consider: {name}'s movable time is in {programs} — shifting it protects the falling SOPs at the least cost.",
    de: 'Erwägen: Die verlagerbare Zeit von {name} liegt in {programs} — sie zu verschieben schützt die fallenden SOPs mit dem geringsten Aufwand.',
    ja: '検討: {name}の融通可能な時間は{programs}にあります — そこから移すのが最小コストで悪化中のSOPを守れます。',
    ko: '고려: {name}의 옮길 수 있는 시간은 {programs}에 있습니다 — 이를 옮기면 최소 비용으로 악화 중인 SOP를 지킬 수 있습니다.',
  },
  clConsiderTiebreak: {
    en: "If all can't be protected, decide which program gets their time: {program} carries the most volume.",
    de: 'Falls nicht alle zu schützen sind: entscheiden, welches Programm die Zeit bekommt — {program} trägt das größte Volumen.',
    ja: 'すべて守れない場合はどのプログラムに時間を充てるか決めます: 台数が最も大きいのは{program}です。',
    ko: '모두 지킬 수 없다면 어느 프로그램에 시간을 줄지 정해야 합니다: 물량이 가장 큰 곳은 {program}입니다.',
  },
  clConsiderPartner: {
    en: 'Consider: one company is active in {n} programs — ask {name} for their staffing plan. {program} is the only SOP they gate today; a named team there closes the biggest exposure.',
    de: 'Erwägen: Ein Unternehmen ist in {n} Programmen aktiv — {name} nach dem Besetzungsplan fragen. {program} ist der einzige SOP, den sie derzeit bestimmen; ein benanntes Team dort schließt das größte Risiko.',
    ja: '検討: 一社で{n}件のプログラムに関与 — {name}に体制計画を確認しましょう。現在SOPを左右しているのは{program}のみで、そこへの専任チームが最大のリスクを解消します。',
    ko: '고려: 한 회사가 {n}개 프로그램에 관여 중 — {name}에 인력 계획을 요청하세요. 현재 SOP를 좌우하는 곳은 {program}뿐이며, 그곳의 전담 팀이 가장 큰 위험을 해소합니다.',
  },
  clBusiestLegend: {
    en: 'The top row is the person or company whose calendar is currently delaying the most units across the portfolio. Every name links to its detail page.',
    de: 'Die oberste Zeile ist die Person oder Firma, deren Kalender derzeit portfolioweit die meisten Einheiten verzögert. Jeder Name verlinkt auf seine Detailseite.',
    ja: '最上段は、ポートフォリオ全体で最も多くの台数を遅らせているカレンダーの持ち主です。各名前は詳細ページへリンクします。',
    ko: '맨 윗줄은 포트폴리오 전체에서 가장 많은 물량을 지연시키고 있는 일정의 주인입니다. 모든 이름은 상세 페이지로 연결됩니다.',
  },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** The raw template with its {var} slots intact — for node interpolation (tNodes). */
export function tRaw(locale: Locale, key: StringKey): string {
  return STRINGS[key][locale] ?? STRINGS[key].en;
}

export function t(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
  let s = tRaw(locale, key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Status is inferred from hill progress (see lib/phase.ts) — localized here.
export function statusKey(progress: number): StringKey {
  if (progress <= 0) return 'statusNotStarted';
  if (progress >= 100) return 'statusDone';
  return 'statusInProgress';
}
