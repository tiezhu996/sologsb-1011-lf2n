export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored';
export type SegmentSource = 'live' | 'offline' | 'manual';
/** 字幕线路：主路 / 备路。线路只提供原文，不决定最终采用版本。 */
export type FeedLine = 'primary' | 'backup';

export interface FeedObservation {
  id: string;
  line: FeedLine;
  text: string;
  startTime: number;
  endTime: number;
  receivedAt: number;
  /** 备路回传包内条目键，用于检查点恢复时去重。 */
  packageKey?: string;
}

/** 上游线路送入的原始数据：线路、时间窗、原文，没有任何校对结论。 */
export interface FeedItem {
  line: FeedLine;
  text: string;
  startTime: number;
  endTime?: number;
  receivedAt?: number;
  packageKey?: string;
  observationId?: string;
}

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  endTime: number;
  receivedAt: number;
  confirmedAt?: number;
  speaker: string;
  original: string;
  corrected: string;
  numberHints: string;
  source: SegmentSource;
  state: SegmentState;
  duplicateOf?: string;
  staleReason?: string;
  revision: number;
  tags: string[];
  /** 同一次发言的稳定标识；主备两路覆盖同一发言时共用一条记录。 */
  utteranceKey: string;
  /** 主备两路对同一次发言的原始观测，按到达顺序保存。 */
  observations: FeedObservation[];
  /** 两路文本不一致时为 true，校对员需要并列待选后再确认。 */
  needChoice: boolean;
  /** 校对员选定的线路版本；未选时以 corrected 工作稿为准。 */
  chosenLine?: FeedLine;
  /** 选定那一刻的文本（归一化前），用于判断后到版本是否使旧选择失效。 */
  chosenText?: string;
  /** 上次选定时间；有新版本到达且旧选择失效时会清空。 */
  resolvedAt?: number;
  /** 已确认后主路才到达，仅并列为候选，未覆盖校对稿。 */
  latePrimary?: boolean;
}

export interface TermRule {
  id: string;
  source: string;
  replacement: string;
  speaker: string;
  enabled: boolean;
  caseSensitive: boolean;
  usageCount: number;
  createdAt: number;
}

export interface BackupPackageItem {
  id: string;
  text: string;
  startTime: number;
  endTime?: number;
}

export interface BackupPackage {
  id: string;
  sentAt: number;
  items: BackupPackageItem[];
}

export interface BackupImportState {
  packageId: string;
  checkpoint: number;
  total: number;
  appliedKeys: string[];
  status: 'importing' | 'failed' | 'done';
  failAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface DeskModel {
  schemaVersion: number;
  eventName: string;
  eventDate: string;
  segments: CaptionSegment[];
  rules: TermRule[];
  selectedId: string;
  connection: ConnectionState;
  simulatedDelay: number;
  fontSize: number;
  nextSequence: number;
  autoStream: boolean;
  /** 当前值守线路：切到备份后，实时模拟片段走备路。 */
  activeLine: FeedLine;
  /** 备路回传包导入检查点。 */
  backupImport?: BackupImportState | null;
  lastMergedAt?: number;
  updatedAt: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

const now = Date.now();
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';
export const SCHEMA_VERSION = 2;
const DEFAULT_SEGMENT_SECONDS = 8;

const SPEAKERS = ['主持人', '主讲人', '嘉宾 / 周然', '现场提问'];

export function lineLabel(line: FeedLine): string {
  return line === 'primary' ? '主路' : '备路';
}

export function defaultSpeaker(sequence: number): string {
  return SPEAKERS[(Math.max(1, sequence) - 1) % SPEAKERS.length];
}

function observation(
  id: string,
  line: FeedLine,
  text: string,
  startTime: number,
  endTime: number,
  receivedAt: number,
  packageKey?: string,
): FeedObservation {
  return { id, line, text, startTime, endTime, receivedAt, ...(packageKey ? { packageKey } : {}) };
}

function segment(
  id: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  const receivedAt = now - (100 - sequence) * 8_000;
  return {
    id,
    sequence,
    startTime,
    endTime: startTime + 7,
    receivedAt,
    confirmedAt: state === 'confirmed' ? now - (100 - sequence) * 7_000 : undefined,
    speaker,
    original,
    corrected,
    numberHints: '',
    source: 'live',
    state,
    revision: 0,
    tags: [],
    utteranceKey: `u-${id}`,
    observations: [observation(`obs-${id}-primary`, 'primary', original, startTime, startTime + 7, receivedAt)],
    needChoice: false,
  };
}

/** 给一条已有发言补上备路观测；文本不同则进入并列待选。 */
function withBackup(seg: CaptionSegment, text: string, receivedAt = seg.receivedAt + 900): CaptionSegment {
  const obs: FeedObservation = observation(`obs-${seg.id}-backup`, 'backup', text, seg.startTime, seg.endTime, receivedAt);
  const needChoice = normalizeCompare(text) !== normalizeCompare(seg.observations[0].text);
  return { ...seg, observations: [...seg.observations, obs], needChoice };
}

const seededSegments: CaptionSegment[] = [
  withBackup(segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'), '欢迎大家来到二零二六年产品发布会。'),
  withBackup(segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块，首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'), '今天我们会介绍三个模块，首先是实时协作。'),
  segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
  withBackup(segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'pending'), '我们使用 studio cloud 平台作为演示环境。'),
  withBackup(segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'pending'), '每分钟大约会收到一百二十个片段。'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot，需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'pending'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'pending'),
];

export function createInitialModel(): DeskModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventName: '新品发布会现场字幕',
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: seededSegments,
    rules: [
      { id: 'term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
      { id: 'term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
      { id: 'term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
    ],
    selectedId: 'seg-4',
    connection: 'connected',
    simulatedDelay: 1.8,
    fontSize: 18,
    nextSequence: 9,
    autoStream: true,
    activeLine: 'primary',
    backupImport: null,
    updatedAt: now,
  };
}

export function cloneModel(model: DeskModel): DeskModel {
  return structuredClone(model);
}

export function normalizeNumbers(text: string): string {
  const digitMap: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };
  const chineseNumber = (raw: string): number => {
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百千万]/u.test(raw)) return Number([...raw].map((char) => digits[char] ?? 0).join(''));
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of raw) {
      if (digits[char] !== undefined) {
        number = digits[char];
      } else if (char === '十') {
        section += (number || 1) * 10;
        number = 0;
      } else if (char === '百') {
        section += (number || 1) * 100;
        number = 0;
      } else if (char === '千') {
        section += (number || 1) * 1000;
        number = 0;
      } else if (char === '万') {
        total += (section + number) * 10_000;
        section = 0;
        number = 0;
      }
    }
    return total + section + number;
  };

  return text
    .replace(/[０-９]/g, (char) => digitMap[char] ?? char)
    .replace(/([零〇一二两三四五六七八九十百千万]+)/gu, (match) => String(chineseNumber(match)))
    .replace(/(?<=\d)[，,](?=\d{3}\b)/g, ',');
}

export function normalizePunctuation(text: string): string {
  return text
    .replace(/([，。！？；：])(?=[^\s，。！？；：])/gu, '$1')
    .replace(/\s+([，。！？；：])/gu, '$1')
    .replace(/([,;:!?])(?=[^\s,;:!?])/g, (match) => ({ ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' }[match] ?? match));
}

export function applyRules(text: string, model: DeskModel): { text: string; used: string[] } {
  let next = text;
  const used: string[] = [];
  for (const rule of model.rules.filter((item) => item.enabled)) {
    if (!rule.source || !next) continue;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (expression.test(next)) {
      next = next.replace(expression, rule.replacement);
      used.push(rule.id);
    }
  }
  return { text: normalizePunctuation(next), used };
}

/* ------------------------------------------------------------------ */
/* 主备对账：匹配同一次发言、合并两路观测、并列候选                     */
/* ------------------------------------------------------------------ */

/** 去除空白、标点和分词符后的比较文本：标点/大小写/连字符差异不算“文本不同”。 */
export function normalizeCompare(value: string): string {
  return value
    .replace(/[\s，。！？；：、…—–\-_.,;:!?'"“”‘’（）()【】\[\]{}<>《》「」]/g, '')
    .toLocaleLowerCase();
}

function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/** 字符二元组 Dice 相似度，用于中文转写的近似匹配。 */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    left.set(gram, (left.get(gram) ?? 0) + 1);
  }
  const right = new Map<string, number>();
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const inLeft = left.get(gram) ?? 0;
    const inRight = right.get(gram) ?? 0;
    if (inRight < inLeft) intersection += 1;
    right.set(gram, inRight + 1);
  }
  return (2 * intersection) / ((a.length - 1) + (b.length - 1));
}

/**
 * 新到观测是否属于某条本地记录：
 * 时间窗接近，且与该发言任一已有观测、原文或校对稿匹配。
 * 这样人工改过 corrected 后，主路补回的同次发言仍能合并而不是新建重复片段。
 */
function matchesSegment(probe: { startTime: number; endTime: number; text: string }, seg: CaptionSegment): boolean {
  const probeNorm = normalizeCompare(probe.text);
  if (!probeNorm) return false;
  const windows: Array<[number, number]> = [[seg.startTime, seg.endTime], ...seg.observations.map((obs): [number, number] => [obs.startTime, obs.endTime])];
  const texts = [seg.original, seg.corrected, ...seg.observations.map((obs) => obs.text)];
  for (let i = 0; i < windows.length; i += 1) {
    const [start, end] = windows[i];
    const other = normalizeCompare(texts[i]);
    if (!other) continue;
    // 完全一致：同一发言的重传/补回，允许较宽的时间抖动。
    if (probeNorm === other && Math.abs(probe.startTime - start) <= 12) return true;
    // 近似或包含：必须真正落在同一时间窗内，避免把相邻的连续两句合并。
    if (windowsOverlap(probe.startTime, probe.endTime, start, end)) {
      if (probeNorm.includes(other) || other.includes(probeNorm)) return true;
      if (textSimilarity(probeNorm, other) >= 0.7) return true;
    }
  }
  return false;
}

export interface TextCandidate {
  line: FeedLine;
  text: string;
  latestReceivedAt: number;
  count: number;
}

/** 汇总一条发言的并列文本候选（按比较文本去重，主路在前）。 */
export function getCandidates(seg: CaptionSegment): TextCandidate[] {
  const byKey = new Map<string, TextCandidate>();
  for (const obs of seg.observations) {
    const key = normalizeCompare(obs.text);
    const found = byKey.get(key);
    if (found) {
      found.count += 1;
      found.latestReceivedAt = Math.max(found.latestReceivedAt, obs.receivedAt);
    } else {
      byKey.set(key, { line: obs.line, text: obs.text, latestReceivedAt: obs.receivedAt, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.line === b.line ? b.latestReceivedAt - a.latestReceivedAt : a.line === 'primary' ? -1 : 1));
}

export function hasBothLines(seg: CaptionSegment): boolean {
  return seg.observations.some((obs) => obs.line === 'primary') && seg.observations.some((obs) => obs.line === 'backup');
}

/** 待校对员处理的并列待选：两路文本不一致、尚未选定、且还没确认。 */
export function hasOpenChoice(seg: CaptionSegment): boolean {
  return seg.needChoice && !seg.resolvedAt && seg.state !== 'confirmed' && seg.state !== 'ignored';
}

export interface AdoptResult {
  model: DeskModel;
  segment: CaptionSegment;
  changedText: boolean;
}

/**
 * 本地确认记录决定采用哪一版：选定某路文本。
 * 仅当当前工作稿还未被人工改动（与旧候选一致）时才同步文本，
 * 后到的主路内容永远不能盖掉已确认或已人工修改的校对稿。
 */
export function adoptCandidate(model: DeskModel, segmentId: string, line: FeedLine): AdoptResult | undefined {
  const target = model.segments.find((seg) => seg.id === segmentId);
  if (!target) return undefined;
  const candidate = getCandidates(target).find((item) => item.line === line);
  if (!candidate) return undefined;
  const oldCandidates = getCandidates(target);
  const workingLooksAuto = oldCandidates.some((item) => normalizeCompare(item.text) === normalizeCompare(target.corrected));
  const changedText = workingLooksAuto && normalizeCompare(target.corrected) !== normalizeCompare(candidate.text);
  // 必须严格晚于所有当前观测的到达时间，否则同批后到观测会让选择立即失效。
  const resolvedAt = Math.max(Date.now(), ...target.observations.map((obs) => obs.receivedAt)) + 1;
  const segment: CaptionSegment = {
    ...target,
    chosenLine: line,
    chosenText: candidate.text,
    resolvedAt,
    latePrimary: target.state === 'confirmed' ? target.latePrimary : false,
    corrected: changedText ? candidate.text : target.corrected,
    revision: changedText ? target.revision + 1 : target.revision,
  };
  return {
    model: {
      ...model,
      segments: model.segments.map((seg) => (seg.id === segmentId ? segment : seg)),
      updatedAt: Date.now(),
    },
    segment,
    changedText,
  };
}

function refreshChoice(seg: CaptionSegment, previousKeys?: Set<string>): CaptionSegment {
  const candidates = getCandidates(seg);
  const needChoice = candidates.length > 1;
  let { chosenLine, chosenText, resolvedAt } = seg;
  if (!needChoice) {
    chosenLine = undefined;
    chosenText = undefined;
    resolvedAt = undefined;
  } else if (resolvedAt) {
    const chosenNorm = chosenText ? normalizeCompare(chosenText) : undefined;
    // 选定之后出现了选择时不存在的候选版本（后到的主路/备路新转写）→ 重新人工确认；
    // 仅有同一文本的重复观测则保持原选择。已确认片段的校对稿始终不被覆盖。
    const knownKeys = previousKeys ?? new Set(seg.observations.filter((obs) => obs.receivedAt <= resolvedAt!).map((obs) => normalizeCompare(obs.text)));
    const newVariantArrived = chosenNorm
      ? candidates.some((candidate) => normalizeCompare(candidate.text) !== chosenNorm && !knownKeys.has(normalizeCompare(candidate.text)))
      : true;
    if (newVariantArrived) {
      chosenLine = undefined;
      chosenText = undefined;
      resolvedAt = undefined;
    }
  }
  return { ...seg, needChoice, chosenLine, chosenText, resolvedAt };
}

export interface IngestResult {
  model: DeskModel;
  created: number;
  merged: number;
  conflicts: number;
  skipped: number;
  latePrimary: number;
}

/**
 * 主备线路入队对账。
 * - 同一次发言合并成一条，不会产生第二个片段；
 * - 文本不同只置为并列待选，绝不覆盖 corrected 工作稿或已确认校对；
 * - packageKey / observationId 保证重传与检查点重试幂等。
 */
export function ingestFeed(model: DeskModel, input: FeedItem[]): IngestResult {
  const tally = { created: 0, merged: 0, conflicts: 0, skipped: 0, latePrimary: 0 };
  const batchKeys = new Set<string>();
  const batchObsIds = new Set<string>();
  let segments = model.segments.map((item) => ({ ...item, observations: [...item.observations] }));
  let nextSequence = model.nextSequence;
  const stamp = Date.now();

  const appliedBefore = new Set<string>(appliedPackageKeys(model));

  const items = [...input].sort((a, b) => a.startTime - b.startTime);
  for (const raw of items) {
    const receivedAt = raw.receivedAt ?? stamp;
    const endTime = raw.endTime ?? raw.startTime + DEFAULT_SEGMENT_SECONDS;
    const { packageKey, observationId } = raw;

    // 幂等：检查点重试 / 同一批次重传 / 已落库的观测 ID 都直接跳过。
    if (packageKey && (appliedBefore.has(packageKey) || batchKeys.has(packageKey))) {
      tally.skipped += 1;
      continue;
    }
    if (observationId && (segments.some((seg) => seg.observations.some((obs) => obs.id === observationId)) || batchObsIds.has(observationId))) {
      tally.skipped += 1;
      continue;
    }
    if (packageKey) batchKeys.add(packageKey);
    if (observationId) batchObsIds.add(observationId);

    const probe = { startTime: raw.startTime, endTime, text: raw.text };
    const target = segments.find(
      (item) => item.state !== 'ignored' && (!packageKey || !item.observations.some((obs) => obs.packageKey === packageKey)) && matchesSegment(probe, item),
    );

    if (target) {
      const obsId = observationId ?? `obs-${target.id}-${raw.line}-${receivedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const wasOpen = hasOpenChoice(target);
      const previousKeys = new Set(target.observations.map((obs) => normalizeCompare(obs.text)));
      target.observations.push(observation(obsId, raw.line, raw.text, raw.startTime, endTime, receivedAt, packageKey));
      Object.assign(target, refreshChoice(target, previousKeys));
      target.receivedAt = Math.min(target.receivedAt, receivedAt);
      tally.merged += 1;

      if (
        target.state === 'confirmed'
        && raw.line === 'primary'
        && receivedAt >= (target.confirmedAt ?? 0)
        && getCandidates(target).some((candidate) => normalizeCompare(candidate.text) !== normalizeCompare(target.corrected))
      ) {
        target.latePrimary = true;
        target.tags = [...new Set([...target.tags, '主路后到版本已并列，未覆盖确认稿'])];
        tally.latePrimary += 1;
      }
      // 新打开的并列待选（之前两路一致或只有一路）才提示冲突。
      if (!wasOpen && hasOpenChoice(target)) tally.conflicts += 1;
      continue;
    }

    const sequence = nextSequence;
    nextSequence += 1;
    const id = packageKey ? `seg-pkg-${sequence}-${receivedAt.toString(36)}` : `seg-${raw.line}-${sequence}-${receivedAt.toString(36)}`;
    const seg: CaptionSegment = {
      id,
      sequence,
      startTime: raw.startTime,
      endTime,
      receivedAt,
      speaker: defaultSpeaker(sequence),
      original: raw.text,
      corrected: raw.text,
      numberHints: '',
      source: 'live',
      state: 'pending',
      revision: 0,
      tags: [],
      utteranceKey: `u-${id}`,
      observations: [observation(observationId ?? `obs-${id}-${raw.line}`, raw.line, raw.text, raw.startTime, endTime, receivedAt, packageKey)],
      needChoice: false,
    };
    segments.push(seg);
    tally.created += 1;
  }

  segments = segments.sort((a, b) => a.startTime - b.startTime || a.receivedAt - b.receivedAt);
  return {
    model: { ...model, segments, nextSequence, updatedAt: stamp },
    ...tally,
  };
}

/** 模型中所有已经应用过的回传包条目键。 */
function appliedPackageKeys(model: DeskModel): string[] {
  const keys: string[] = [];
  for (const seg of model.segments) {
    for (const obs of seg.observations) {
      if (obs.packageKey) keys.push(obs.packageKey);
    }
  }
  return [...keys, ...(model.backupImport?.appliedKeys ?? [])];
}

/**
 * 切换主备线路。
 * 从备路切回主路时，主路会把备路值守期间的同一次发言重新送回：
 * 相同文本静默合并，文本不同进入并列待选，不产生重复片段。
 */
export function switchLine(model: DeskModel, line: FeedLine): { model: DeskModel; replayed: number; conflicts: number; latePrimary: number } {
  if (model.activeLine === line) return { model, replayed: 0, conflicts: 0, latePrimary: 0 };
  let working = { ...model, activeLine: line, updatedAt: Date.now() };
  let replayed = 0;
  if (line === 'primary') {
    const replay: FeedItem[] = [];
    for (const seg of model.segments) {
      if (seg.state === 'ignored') continue;
      if (seg.observations.some((obs) => obs.line === 'primary')) continue;
      const backupText = seg.observations.find((obs) => obs.line === 'backup')?.text ?? seg.original;
      // 主路 ASR 与备路存在转写差异的发言：演示并列待选。
      const text = seg.sequence % 3 === 1 ? `${backupText.replace(/[。！？…]*$/, '')}（主路转写）。` : backupText;
      replay.push({
        line: 'primary',
        text,
        startTime: seg.startTime,
        endTime: seg.endTime,
        receivedAt: Date.now(),
        observationId: `obs-primary-catchup-${seg.id}`,
      });
      replayed += 1;
    }
    if (replay.length) {
      const result = ingestFeed(working, replay);
      working = result.model;
      return { model: working, replayed, conflicts: result.conflicts, latePrimary: result.latePrimary };
    }
  }
  return { model: working, replayed, conflicts: 0, latePrimary: 0 };
}

/* ------------------------------------------------------------------ */
/* 备路回传包：检查点导入、失败恢复、重试幂等                           */
/* ------------------------------------------------------------------ */

export interface BackupImportResult {
  model: DeskModel;
  imported: number;
  created: number;
  merged: number;
  conflicts: number;
  skipped: number;
  checkpoint: number;
  failed: boolean;
  done: boolean;
  error?: string;
}

/**
 * 导入备路回传包；可在 failAtIndex 处模拟失败。
 * 失败时已应用条目与检查点随模型持久化，重试从检查点继续且不重复生成。
 */
export function importBackupPackage(model: DeskModel, pkg: BackupPackage, failAtIndex = Number.POSITIVE_INFINITY): BackupImportResult {
  const stamp = Date.now();
  const existing = model.backupImport?.packageId === pkg.id && model.backupImport.status !== 'done' ? model.backupImport : null;
  // 重试沿用旧检查点；同一失败位置可再次模拟中断，位置在检查点之前则顺延为下一条。
  const state: BackupImportState = existing
    ? {
      ...existing,
      status: 'importing',
      lastError: undefined,
      failAt: Math.max(existing.checkpoint, failAtIndex),
      updatedAt: stamp,
    }
    : {
      packageId: pkg.id,
      checkpoint: 0,
      total: pkg.items.length,
      appliedKeys: [],
      status: 'importing',
      failAt: failAtIndex,
      updatedAt: stamp,
    };

  let working: DeskModel = { ...model, backupImport: state };
  let imported = 0;
  let created = 0;
  let merged = 0;
  let conflicts = 0;
  let skipped = 0;

  for (let index = state.checkpoint; index < pkg.items.length; index += 1) {
    if (index === state.failAt) {
      const failed: BackupImportState = {
        ...state,
        status: 'failed',
        updatedAt: Date.now(),
        lastError: `备路回传包在第 ${index + 1}/${pkg.items.length} 条后中断，已保存检查点`,
      };
      return {
        model: { ...working, backupImport: failed, updatedAt: Date.now() },
        imported, created, merged, conflicts, skipped,
        checkpoint: index,
        failed: true,
        done: false,
        error: failed.lastError,
      };
    }
    const item = pkg.items[index];
    const packageKey = `${pkg.id}:${item.id}`;
    const result = ingestFeed(working, [{
      line: 'backup',
      text: item.text,
      startTime: item.startTime,
      endTime: item.endTime ?? item.startTime + DEFAULT_SEGMENT_SECONDS,
      receivedAt: pkg.sentAt,
      packageKey,
      observationId: `obs-${pkg.id}-${item.id}`,
    }]);
    working = result.model;
    created += result.created;
    merged += result.merged;
    conflicts += result.conflicts;
    skipped += result.skipped;
    imported += result.skipped ? 0 : 1;
    state.appliedKeys = [...new Set([...state.appliedKeys, packageKey])];
    state.checkpoint = index + 1;
    state.updatedAt = Date.now();
    working = { ...working, backupImport: { ...state } };
  }

  const done: BackupImportState = { ...state, status: 'done', updatedAt: Date.now() };
  return {
    model: { ...working, backupImport: done, updatedAt: Date.now() },
    imported, created, merged, conflicts, skipped,
    checkpoint: pkg.items.length,
    failed: false,
    done: true,
  };
}

/** 演示用备路回传包：包含可合并、冲突与新增三类条目。ID 固定以便跨刷新恢复检查点。 */
export function createDemoBackupPackage(): BackupPackage {
  return {
    id: 'bp-demo-failover',
    sentAt: Date.now(),
    items: [
      { id: 'bp-1', text: '延迟和质量监测会帮助我们保持字幕稳定。', startTime: 15 },
      { id: 'bp-2', text: '如果主持人提到 co pilot，需要统一专有名词大小写。', startTime: 43 },
      { id: 'bp-3', text: '备路补传：请技术同事确认音量电平。', startTime: 70 },
      { id: 'bp-4', text: '备路补传：下一组演示数据已经准备就绪。', startTime: 79 },
      { id: 'bp-5', text: '备路补传：发布会将在十分钟后进入问答环节。', startTime: 88 },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 旧草稿迁移：无线路信息按主路兼容打开，并折叠重复片段                 */
/* ------------------------------------------------------------------ */

function isValidBackupImport(value: unknown): BackupImportState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<BackupImportState>;
  if (typeof state.packageId !== 'string' || typeof state.checkpoint !== 'number' || typeof state.total !== 'number') return null;
  if (state.status !== 'importing' && state.status !== 'failed' && state.status !== 'done') return null;
  return state as BackupImportState;
}

/**
 * 把任意历史草稿迁移到主备对账模型：
 * - 缺失线路信息的观测按主路补全；
 * - 旧 duplicate 片段折叠进其指向的发言（作为备路观测），找不到归属则恢复待确认；
 * - 全量再做一次同发言对账，保证时间线、统计和导出无重复。
 */
export function migrateModel(raw: Partial<DeskModel> | null | undefined): DeskModel {
  if (!raw || !Array.isArray(raw.segments) || !raw.segments.length) return createInitialModel();
  const stamp = Date.now();

  const legacy = raw.segments as Array<Partial<CaptionSegment> & { duplicateOf?: string; staleReason?: string }>;
  const built: CaptionSegment[] = [];

  for (const item of legacy) {
    if (!item.id) continue;
    const startTime = Number(item.startTime ?? 0);
    const endTime = Number(item.endTime ?? startTime + DEFAULT_SEGMENT_SECONDS);
    const receivedAt = Number(item.receivedAt ?? stamp);
    const text = typeof item.original === 'string' ? item.original : '';
    const observations: FeedObservation[] = Array.isArray(item.observations) && item.observations.length
      ? item.observations.map((obs, index) => ({
        id: String(obs.id ?? `obs-${item.id}-${index}`),
        line: obs.line === 'backup' ? 'backup' : 'primary',
        text: String(obs.text ?? text),
        startTime: Number(obs.startTime ?? startTime),
        endTime: Number(obs.endTime ?? obs.startTime ?? endTime),
        receivedAt: Number(obs.receivedAt ?? receivedAt),
        ...(obs.packageKey ? { packageKey: obs.packageKey } : {}),
      }))
      : [observation(`obs-${item.id}-legacy-primary`, 'primary', text, startTime, endTime, receivedAt)];

    const seg: CaptionSegment = {
      id: item.id,
      sequence: typeof item.sequence === 'number' ? item.sequence : built.length + 1,
      startTime,
      endTime,
      receivedAt,
      ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
      speaker: typeof item.speaker === 'string' && item.speaker ? item.speaker : defaultSpeaker(typeof item.sequence === 'number' ? item.sequence : 1),
      original: text,
      corrected: typeof item.corrected === 'string' && item.corrected ? item.corrected : text,
      numberHints: typeof item.numberHints === 'string' ? item.numberHints : '',
      source: item.source === 'offline' || item.source === 'manual' ? item.source : 'live',
      state: item.state === 'duplicate' ? 'duplicate' : item.state === 'stale' ? 'stale' : item.state === 'ignored' ? 'ignored' : item.state === 'confirmed' ? 'confirmed' : 'pending',
      ...(item.duplicateOf ? { duplicateOf: item.duplicateOf } : {}),
      ...(item.staleReason ? { staleReason: item.staleReason } : {}),
      revision: typeof item.revision === 'number' ? item.revision : 0,
      tags: Array.isArray(item.tags) ? item.tags : [],
      utteranceKey: typeof item.utteranceKey === 'string' ? item.utteranceKey : `u-legacy-${item.id}`,
      observations,
      needChoice: false,
      ...(item.chosenLine === 'primary' || item.chosenLine === 'backup' ? { chosenLine: item.chosenLine } : {}),
      ...(item.chosenText ? { chosenText: item.chosenText } : {}),
      ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
      ...(item.latePrimary ? { latePrimary: true } : {}),
    };
    built.push(seg);
  }

  // 旧 duplicate 片段不再独立存在：折叠为其归属发言的备路观测。
  const byId = new Map(built.map((item) => [item.id, item]));
  const segments: CaptionSegment[] = [];
  for (const seg of built) {
    if (seg.state !== 'duplicate') {
      segments.push(seg);
      continue;
    }
    const target = seg.duplicateOf ? byId.get(seg.duplicateOf) : undefined;
    if (target && target !== seg) {
      const foldedObs = seg.observations.map((obs, index) => ({
        ...obs,
        id: `obs-${seg.id}-folded-backup-${index}`,
        line: 'backup' as FeedLine,
      }));
      target.observations.push(...foldedObs);
      if (normalizeCompare(seg.corrected || seg.original) !== normalizeCompare(target.corrected) && target.state === 'confirmed') {
        target.latePrimary = true;
        target.tags = [...new Set([...target.tags, '旧草稿重复片段已折叠为备路候选'])];
      }
      Object.assign(target, refreshChoice(target));
      continue;
    }
    seg.state = 'pending';
    seg.staleReason = '旧草稿的重复标记已解除，请重新核对';
    delete seg.duplicateOf;
    segments.push(seg);
  }

  // 全量再对账：折叠剩余的同一次发言（按时间窗+文本匹配），确保无重复片段。
  const reconciled: CaptionSegment[] = [];
  for (const seg of segments.sort((a, b) => a.startTime - b.startTime || a.receivedAt - b.receivedAt)) {
    const probe = { startTime: seg.startTime, endTime: seg.endTime, text: seg.corrected || seg.original };
    const target = reconciled.find((item) => item.state !== 'ignored' && matchesSegment(probe, item));
    if (target) {
      for (const obs of seg.observations) target.observations.push(obs);
      // 被折叠的待确认片段如果已有人工校对，其文本作为候选保留，不直接覆盖当前稿。
      if (seg.state !== 'confirmed' && normalizeCompare(seg.corrected) !== normalizeCompare(seg.original)) {
        target.observations.push(observation(`obs-${seg.id}-folded-edit`, 'backup', seg.corrected, seg.startTime, seg.endTime, seg.receivedAt));
      }
      target.tags = [...new Set([...target.tags, ...seg.tags])];
      Object.assign(target, refreshChoice(target));
    } else {
      reconciled.push(seg);
    }
  }
  const refreshed = reconciled
    .map((seg) => refreshChoice(seg))
    .map((seg) => (seg.state === 'duplicate'
      ? { ...seg, state: 'pending' as SegmentState, duplicateOf: undefined, staleReason: seg.staleReason ?? '旧的重复标记已由主备对账接管' }
      : seg))
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime);

  return {
    schemaVersion: SCHEMA_VERSION,
    eventName: typeof raw.eventName === 'string' ? raw.eventName : '未命名直播',
    eventDate: typeof raw.eventDate === 'string' ? raw.eventDate : new Date(stamp).toISOString().slice(0, 10),
    segments: refreshed,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    selectedId: typeof raw.selectedId === 'string' && refreshed.some((seg) => seg.id === raw.selectedId) ? raw.selectedId : refreshed[0]?.id ?? '',
    connection: raw.connection === 'offline' || raw.connection === 'degraded' ? raw.connection : 'connected',
    simulatedDelay: typeof raw.simulatedDelay === 'number' ? raw.simulatedDelay : 1.8,
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : 18,
    nextSequence: typeof raw.nextSequence === 'number' ? raw.nextSequence : Math.max(9, ...refreshed.map((seg) => seg.sequence + 1)),
    autoStream: typeof raw.autoStream === 'boolean' ? raw.autoStream : true,
    activeLine: raw.activeLine === 'backup' ? 'backup' : 'primary',
    backupImport: isValidBackupImport(raw.backupImport) ? raw.backupImport : null,
    ...(raw.lastMergedAt ? { lastMergedAt: raw.lastMergedAt } : {}),
    updatedAt: stamp,
  };
}

/* ------------------------------------------------------------------ */
/* 合并、统计、导出、实时模拟                                           */
/* ------------------------------------------------------------------ */

/** 恢复连接后的统一合并：再做一次对账，并按原规则标记离线过期内容。 */
export function mergeConfirmedSegments(model: DeskModel): DeskModel {
  const migrated = migrateModel({ ...model, schemaVersion: SCHEMA_VERSION, segments: model.segments });
  const stamp = Date.now();
  const segments = migrated.segments.map((item) => {
    const next = { ...item };
    if (item.source === 'offline' && item.state === 'confirmed') {
      next.source = item.confirmedAt && stamp - item.confirmedAt > 90_000 ? 'offline' : 'live';
      next.staleReason = stamp - item.receivedAt > 90_000 ? `离线恢复后合并，原始片段已延迟 ${Math.round((stamp - item.receivedAt) / 1000)} 秒` : undefined;
      if (next.staleReason) next.state = 'stale';
    }
    return next;
  });

  return {
    ...model,
    segments,
    connection: 'connected',
    simulatedDelay: Math.max(0.8, model.simulatedDelay - 0.7),
    lastMergedAt: stamp,
    updatedAt: stamp,
  };
}

export function queueStats(model: DeskModel) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  const choices = model.segments.filter(hasOpenChoice);
  const reconciled = model.segments.filter(hasBothLines);
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline: offline.length,
    choices: choices.length,
    reconciled: reconciled.length,
    backlog: pending.length + stale.length + duplicate.length + offline.length,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

const STREAM_SAMPLES = [
  '接下来请产品团队介绍新的工作流。',
  '请注意屏幕右侧的实时队列状态。',
  '在弱网环境下我们会保留未确认片段。',
  '如果网络恢复，系统会按照时间顺序自动合并。',
  '这段字幕包含二零二五年的项目数据。',
  '大家可以在会后查看完整回放和术语表。',
];

function createStreamItem(sequence: number, line: FeedLine): FeedItem {
  const start = Math.max(0, sequence * 9 - 10);
  const stamp = Date.now();
  return {
    line,
    text: STREAM_SAMPLES[(sequence - 1) % STREAM_SAMPLES.length],
    startTime: start,
    endTime: start + 8,
    receivedAt: stamp,
  };
}

/** 5 秒心跳：当前值守线路产生一条观测，经对账后入队；离线时不进片。 */
export function simulateTick(model: DeskModel): DeskModel {
  if (model.connection === 'offline') return model;
  const step = model.connection === 'degraded' ? 0.7 : model.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((model.simulatedDelay + step).toFixed(1))));
  let next: DeskModel = { ...model, simulatedDelay: delay, connection: delay > 4.2 ? 'degraded' : model.connection };
  if (model.autoStream && Math.random() > 0.68) {
    next = ingestFeed(next, [createStreamItem(model.nextSequence, model.activeLine)]).model;
  }
  const pendingCutoff = Date.now() - 90_000;
  return {
    ...next,
    segments: next.segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
      ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
      : item),
    updatedAt: Date.now(),
  };
}

export function toSrt(model: DeskModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  const seen = new Set<string>();
  return model.segments
    .filter((item) => item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime)
    .filter((item) => {
      // 主备对账后每条发言只有一条记录；再按发言键兜底去重。
      if (seen.has(item.utteranceKey)) return false;
      seen.add(item.utteranceKey);
      return true;
    })
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.endTime || item.startTime + 7)}\n[${item.speaker}] ${item.corrected}\n`)
    .join('\n');
}
