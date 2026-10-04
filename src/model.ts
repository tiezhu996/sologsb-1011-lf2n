export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored';
export type SegmentSource = 'live' | 'offline' | 'manual';
/** 供稿线路：主路 / 备路。 */
export type FeedLine = 'primary' | 'backup';

/** 线路回传的原始包：只携带线路、时间窗与原文。 */
export interface FeedPacket {
  id: string;
  line: FeedLine;
  startTime: number;
  endTime: number;
  text: string;
}

/** 同一次发言的另一线路版本，并列待选。 */
export interface CaptionVariant {
  line: FeedLine;
  text: string;
  receivedAt: number;
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
  /** 当前采用文本来自哪条线路。 */
  line: FeedLine;
  state: SegmentState;
  duplicateOf?: string;
  staleReason?: string;
  revision: number;
  tags: string[];
  /** 另一线路覆盖同一次发言时留下的待选版本。 */
  variants: CaptionVariant[];
  /** 已对账进本片段的回传包 id，重试时用于幂等跳过。 */
  packetIds: string[];
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

/** 备路回传包：一组只含线路、时间窗与原文的包。 */
export interface BackhaulPackage {
  id: string;
  createdAt: number;
  packets: FeedPacket[];
}

/** 回传包导入检查点：失败后从这里续传，重试不重复生成。 */
export interface BackhaulCheckpoint {
  packageId: string;
  nextIndex: number;
  total: number;
  imported: number;
  merged: number;
  skipped: number;
  status: 'interrupted' | 'done';
  error?: string;
  updatedAt: number;
}

export interface DeskModel {
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
  lastMergedAt?: number;
  backhaul?: BackhaulCheckpoint;
  backhaulPackage?: BackhaulPackage;
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

function segment(
  id: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  return {
    id,
    sequence,
    startTime,
    endTime: startTime + 7,
    receivedAt: now - (100 - sequence) * 8_000,
    confirmedAt: state === 'confirmed' ? now - (100 - sequence) * 7_000 : undefined,
    speaker,
    original,
    corrected,
    numberHints: '',
    source: 'live',
    line: 'primary',
    state,
    revision: 0,
    tags: [],
    variants: [],
    packetIds: [`seed-${id}`],
  };
}

const seededSegments: CaptionSegment[] = [
  segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'),
  segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'),
  segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
  segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'pending'),
  segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'pending'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'pending'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'pending'),
];

const duplicate: CaptionSegment = {
  ...segment('seg-8', 8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'duplicate'),
  source: 'live',
  duplicateOf: 'seg-2',
  staleReason: '与第 2 段高度相似',
};

export function createInitialModel(): DeskModel {
  return {
    eventName: '新品发布会现场字幕',
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: [...seededSegments, duplicate],
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
    updatedAt: now,
  };
}

/** 旧草稿没有线路信息：按主路兼容打开，并补齐对账所需字段。 */
export function migrateModel(model: DeskModel): DeskModel {
  const segments = (model.segments ?? []).map((item) => {
    const legacy = item as Partial<CaptionSegment> & CaptionSegment;
    return {
      ...item,
      line: legacy.line ?? 'primary',
      endTime: legacy.endTime ?? item.startTime + 7,
      variants: legacy.variants ?? [],
      packetIds: legacy.packetIds ?? [],
    };
  });
  return { ...model, segments };
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

const normalizeText = (value: string) => value.replace(/[\s，。！？；：,.;:!?]/g, '').toLocaleLowerCase();

export function isDuplicate(candidate: CaptionSegment, existing: CaptionSegment[]): CaptionSegment | undefined {
  const candidateText = normalizeText(candidate.corrected || candidate.original);
  return existing.find((segmentItem) => {
    if (segmentItem.id === candidate.id || segmentItem.state === 'ignored') return false;
    const text = normalizeText(segmentItem.corrected || segmentItem.original);
    if (!candidateText || !text) return false;
    return text === candidateText || (Math.abs(segmentItem.startTime - candidate.startTime) < 12 && (text.includes(candidateText) || candidateText.includes(text)));
  });
}

/** 两个时间窗的重合比例（占较短窗口）。 */
function overlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
}

/** 判断回传包与已有片段是否覆盖同一次发言：时间窗大幅重合，或起点接近且文本相似。 */
function coversSameUtterance(segmentItem: CaptionSegment, packet: FeedPacket): boolean {
  if (overlapRatio(segmentItem.startTime, segmentItem.endTime, packet.startTime, packet.endTime) >= 0.4) return true;
  if (Math.abs(segmentItem.startTime - packet.startTime) > 3) return false;
  const text = normalizeText(segmentItem.original);
  const packetText = normalizeText(packet.text);
  return !!text && !!packetText && (text === packetText || text.includes(packetText) || packetText.includes(text));
}

export type ReconcileOutcome = 'created' | 'merged' | 'absorbed' | 'protected' | 'skipped';

/**
 * 主备对账：回传包只提供线路、时间窗与原文。
 * - 两路覆盖同一次发言时合并成一条；文本不同则并列待选。
 * - 已确认的校对由本地确认记录决定，后到的线路内容只留对账记录，绝不覆盖。
 * - 包 id 已入账时直接跳过，重试不会重复生成。
 */
export function reconcilePacket(model: DeskModel, packet: FeedPacket): { model: DeskModel; outcome: ReconcileOutcome; segmentId?: string } {
  const already = model.segments.find((item) => item.packetIds.includes(packet.id));
  if (already) return { model, outcome: 'skipped', segmentId: already.id };

  const packetText = normalizeText(packet.text);
  const match = model.segments.find((item) => item.state !== 'ignored' && coversSameUtterance(item, packet));

  if (!match) {
    const created: CaptionSegment = {
      id: `seg-${packet.line}-${model.nextSequence}-${Date.now().toString(36)}`,
      sequence: model.nextSequence,
      startTime: packet.startTime,
      endTime: packet.endTime,
      receivedAt: Date.now(),
      speaker: '未知发言人',
      original: packet.text,
      corrected: packet.text,
      numberHints: '',
      source: 'live',
      line: packet.line,
      state: 'pending',
      revision: 0,
      tags: [],
      variants: [],
      packetIds: [packet.id],
    };
    return {
      model: { ...model, segments: [...model.segments, created], nextSequence: model.nextSequence + 1, updatedAt: Date.now() },
      outcome: 'created',
      segmentId: created.id,
    };
  }

  const sameText = normalizeText(match.original) === packetText || normalizeText(match.corrected) === packetText;
  const segments = model.segments.map((item): CaptionSegment => {
    if (item.id !== match.id) return item;
    const packetIds = [...item.packetIds, packet.id];
    if (item.state === 'confirmed') {
      // 本地确认记录优先：只登记对账结果，不改动已确认的文本。
      return {
        ...item,
        packetIds,
        variants: sameText ? item.variants : [...item.variants, { line: packet.line, text: packet.text, receivedAt: Date.now() }],
        tags: [...new Set([...item.tags, '主备已对账'])],
      };
    }
    if (sameText) {
      return { ...item, packetIds, tags: [...new Set([...item.tags, '主备一致'])] };
    }
    const variants = [...item.variants];
    if (!variants.some((variant) => normalizeText(variant.text) === packetText)) {
      variants.push({ line: packet.line, text: packet.text, receivedAt: Date.now() });
    }
    return { ...item, packetIds, variants, tags: [...new Set([...item.tags, '主备待选'])] };
  });

  const outcome: ReconcileOutcome = match.state === 'confirmed' ? 'protected' : sameText ? 'absorbed' : 'merged';
  return { model: { ...model, segments, updatedAt: Date.now() }, outcome, segmentId: match.id };
}

/** 备路回传包导入：失败保留检查点，重试从检查点续传且幂等。 */
export function importBackhaul(model: DeskModel, pkg: BackhaulPackage, options: { interruptAfter?: number } = {}): DeskModel {
  const checkpoint = model.backhaul && model.backhaul.packageId === pkg.id && model.backhaul.status === 'interrupted'
    ? model.backhaul
    : undefined;
  let nextIndex = checkpoint?.nextIndex ?? 0;
  let imported = checkpoint?.imported ?? 0;
  let merged = checkpoint?.merged ?? 0;
  let skipped = checkpoint?.skipped ?? 0;
  let current: DeskModel = { ...model, backhaulPackage: pkg };
  let processed = 0;

  while (nextIndex < pkg.packets.length) {
    if (options.interruptAfter !== undefined && processed >= options.interruptAfter) {
      return {
        ...current,
        backhaul: {
          packageId: pkg.id,
          nextIndex,
          total: pkg.packets.length,
          imported,
          merged,
          skipped,
          status: 'interrupted',
          error: '备路回传链路中断，进度已保存到检查点',
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
    }
    const result = reconcilePacket(current, pkg.packets[nextIndex]);
    current = result.model;
    if (result.outcome === 'created') imported += 1;
    else if (result.outcome === 'skipped') skipped += 1;
    else merged += 1;
    nextIndex += 1;
    processed += 1;
  }

  return {
    ...current,
    backhaul: { packageId: pkg.id, nextIndex, total: pkg.packets.length, imported, merged, skipped, status: 'done', updatedAt: Date.now() },
    updatedAt: Date.now(),
  };
}

/** 模拟备路回传包：覆盖最近几段发言（文本带线路差异），再补两条新发言。 */
export function createBackhaulPackage(model: DeskModel): BackhaulPackage {
  const packageId = `backhaul-${Date.now().toString(36)}`;
  const backupVariantOf = (text: string): string => {
    const varied = text
      .replace(/5G/g, '五G')
      .replace(/Co-Pilot/g, 'co pilot')
      .replace(/Studio Cloud/g, 'studio cloud')
      .replace(/，/g, ',')
      .replace(/。$/, '');
    return varied === text && text.endsWith('。') ? text.slice(0, -1) : varied;
  };
  const covered = [...model.segments]
    .filter((item) => item.state !== 'ignored')
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 3)
    .reverse();
  const packets: FeedPacket[] = covered.map((item, index) => ({
    id: `${packageId}#${index}`,
    line: 'backup',
    startTime: item.startTime,
    endTime: item.endTime,
    text: backupVariantOf(item.original),
  }));
  const lastStart = Math.max(0, ...model.segments.map((item) => item.startTime));
  const extras = ['备路回传补充一条现场提示,请核对术语表。', '导播确认下一段嘉宾发言即将开始。'];
  extras.forEach((text, offset) => {
    const start = lastStart + 9 * (offset + 1);
    packets.push({ id: `${packageId}#${covered.length + offset}`, line: 'backup', startTime: start, endTime: start + 7, text });
  });
  return { id: packageId, createdAt: Date.now(), packets };
}

export function mergeConfirmedSegments(model: DeskModel): DeskModel {
  const seen: string[] = [];
  const segments = model.segments
    .map((item) => ({ ...item }))
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)
    .map((item): CaptionSegment => {
      if (item.source === 'offline' && item.state === 'confirmed') {
        item.source = item.confirmedAt && Date.now() - item.confirmedAt > 90_000 ? 'offline' : 'live';
        item.staleReason = Date.now() - item.receivedAt > 90_000 ? `离线恢复后合并，原始片段已延迟 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` : undefined;
        if (item.staleReason) item.state = 'stale';
      }
      const duplicate = isDuplicate(item, seen.map((id) => model.segments.find((segmentItem) => segmentItem.id === id)).filter(Boolean) as CaptionSegment[]);
      if (duplicate && item.state !== 'confirmed') {
        item.state = 'duplicate';
        item.duplicateOf = duplicate.id;
      }
      if (item.state !== 'ignored') seen.push(item.id);
      return item;
    });

  return {
    ...model,
    segments,
    connection: 'connected',
    simulatedDelay: Math.max(0.8, model.simulatedDelay - 0.7),
    lastMergedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function queueStats(model: DeskModel) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  const variants = model.segments.filter((item) => item.variants.length > 0 && item.state !== 'confirmed');
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline: offline.length,
    variants: variants.length,
    // 重复片段不计入积压：主备对账后同一次发言只占一条。
    backlog: pending.length + stale.length + offline.length,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

const LIVE_SAMPLES = [
  '接下来请产品团队介绍新的工作流。',
  '请注意屏幕右侧的实时队列状态。',
  '在弱网环境下我们会保留未确认片段。',
  '如果网络恢复,系统会按照时间顺序自动合并。',
  '这段字幕包含二零二五年的项目数据。',
  '大家可以在会后查看完整回放和术语表。',
];

export function createLivePacket(sequence: number, line: FeedLine): FeedPacket {
  const start = Math.max(0, sequence * 9 - 10);
  return {
    id: `live-${line}-${sequence}-${Date.now().toString(36)}`,
    line,
    startTime: start,
    endTime: start + 7,
    text: LIVE_SAMPLES[(sequence - 1) % LIVE_SAMPLES.length],
  };
}

export function simulateLatency(model: DeskModel): DeskModel {
  if (model.connection === 'offline') return model;
  const step = model.connection === 'degraded' ? 0.7 : model.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((model.simulatedDelay + step).toFixed(1))));
  let connection = model.connection;
  if (delay > 4.2) connection = 'degraded';
  else if (connection === 'degraded' && delay < 3.4) connection = 'connected';

  let next: DeskModel = { ...model, simulatedDelay: delay, connection };
  if (model.autoStream && Math.random() > 0.68) {
    if (connection === 'degraded') {
      // 主路波动期间由备路供稿。
      next = reconcilePacket(next, createLivePacket(next.nextSequence, 'backup')).model;
    } else {
      // 主路恢复后，同一次发言可能作为新片段补发回来，交给对账合并。
      const redelivery = next.segments.find((item) => item.line === 'backup' && item.state !== 'ignored' && !item.packetIds.some((id) => id.includes('primary')));
      if (redelivery && Math.random() > 0.4) {
        next = reconcilePacket(next, {
          id: `live-primary-re-${redelivery.id}-${Date.now().toString(36)}`,
          line: 'primary',
          startTime: redelivery.startTime,
          endTime: redelivery.endTime,
          text: normalizeNumbers(redelivery.original),
        }).model;
      } else {
        next = reconcilePacket(next, createLivePacket(next.nextSequence, 'primary')).model;
      }
    }
  }

  const pendingCutoff = Date.now() - 90_000;
  const segments = next.segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale' as SegmentState, staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
    : item);
  return { ...next, segments, updatedAt: Date.now() };
}

/** 直播区与导出共用的已确认时间线：对账后仍残留的重复（如旧草稿）在这里去重。 */
export function uniqueConfirmedSegments(model: DeskModel): CaptionSegment[] {
  const confirmed = model.segments
    .filter((item) => item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime || a.sequence - b.sequence);
  const kept: CaptionSegment[] = [];
  for (const item of confirmed) {
    if (isDuplicate(item, kept)) continue;
    kept.push(item);
  }
  return kept;
}

export function toSrt(model: DeskModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  return uniqueConfirmedSegments(model)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.endTime)}\n[${item.speaker}] ${item.corrected}\n`)
    .join('\n');
}
