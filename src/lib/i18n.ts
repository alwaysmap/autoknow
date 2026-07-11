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
    en: 'bypass — skips a phase',
    de: 'Umgehung — überspringt eine Phase',
    ja: 'バイパス — フェーズをスキップ',
    ko: '우회 — 단계 건너뜀',
  },
  legendTrack: {
    en: 'track fills as a phase progresses',
    de: 'Strecke füllt sich mit dem Phasenfortschritt',
    ja: '線路はフェーズの進捗に応じて塗られます',
    ko: '트랙은 단계 진행률에 따라 채워집니다',
  },
  toggleDetail: {
    en: 'Toggle detail',
    de: 'Detailansicht umschalten',
    ja: '詳細表示を切り替え',
    ko: '상세 보기 전환',
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
    en: 'Update — what changed (optional, markdown)',
    de: 'Update — was hat sich geändert (optional, Markdown)',
    ja: '更新 — 変更内容（任意・Markdown）',
    ko: '업데이트 — 변경 내용 (선택, 마크다운)',
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
  resource: { en: 'Resource', de: 'Ressource', ja: 'リソース', ko: '리소스' },
  alsoActive: {
    en: 'also on {n} active phases elsewhere',
    de: 'außerdem an {n} aktiven Phasen beteiligt',
    ja: '他プログラムでアクティブなフェーズ{n}件を担当中',
    ko: '다른 프로그램에서 활성 단계 {n}개 동시 진행 중',
  },
  alsoActiveOne: {
    en: 'also on 1 active phase elsewhere',
    de: 'außerdem an 1 aktiven Phase beteiligt',
    ja: '他プログラムでアクティブなフェーズ1件を担当中',
    ko: '다른 프로그램에서 활성 단계 1개 동시 진행 중',
  },
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
  backToPhases: { en: '← Phases', de: '← Phasen', ja: '← フェーズ', ko: '← 단계' },
  history: { en: 'History', de: 'Verlauf', ja: '履歴', ko: '기록' },
  fullHistory: {
    en: 'Full history →',
    de: 'Gesamter Verlauf →',
    ja: '履歴をすべて表示 →',
    ko: '전체 기록 →',
  },
  partnersLabel: { en: 'Partners', de: 'Partner', ja: 'パートナー', ko: '파트너' },
  peopleLabel: { en: 'People', de: 'Personen', ja: '担当者', ko: '관련 인원' },
  details: { en: 'Details', de: 'Details', ja: '詳細', ko: '상세' },
  involved: { en: 'Involved', de: 'Beteiligt', ja: '関係者', ko: '참여' },
  personToInvolve: {
    en: 'Person to involve',
    de: 'Zu beteiligende Person',
    ja: '参加させる担当者',
    ko: '참여시킬 사람',
  },
  addPerson: { en: '+ person…', de: '+ Person…', ja: '+ 担当者…', ko: '+ 사람…' },
  googleFocusLabel: { en: 'Google focus', de: 'Google-Fokus', ja: 'Googleの注力', ko: 'Google 포커스' },
} satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

export function t(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[key][locale] ?? STRINGS[key].en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Status is inferred from hill progress (see lib/phase.ts) — localized here.
export function statusKey(progress: number): StringKey {
  if (progress <= 0) return 'statusNotStarted';
  if (progress >= 100) return 'statusDone';
  return 'statusInProgress';
}
