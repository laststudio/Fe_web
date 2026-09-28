/**
 * 目标分滑块的非线性映射。
 *
 * 分数不该在滑轨上等距分布：真正需要精细控制的是高分段（例如 30 分卷的
 * 27~28.5 分，也就是 90%~95%），而 1~15 分这种低分段基本没人用，占一小段就够。
 *
 * 因此按"得分率"分段做分段线性映射（与卷面总分无关，30/40/100 分卷都适配）：
 *   得分率  0.00 → 0.30   占滑轨  6%
 *           0.30 → 0.50          6%
 *           0.50 → 0.60          8%
 *           0.60 → 0.75         14%
 *           0.75 → 0.85         14%
 *           0.85 → 0.90         14%
 *           0.90 → 0.95         38%   ← 高分段最细腻
 *
 * 结果：30 分卷上 0~15 分只占约 18% 滑轨，24~28.5 分占约 52% 滑轨。
 * 低分段想输入精确值时，直接用旁边的数字输入框即可。
 */

export const SLIDER_RESOLUTION = 1000

const RATIO_BREAKPOINTS = [0, 0.3, 0.5, 0.6, 0.75, 0.85, 0.9, 0.95]
const TRACK_BREAKPOINTS = [0, 0.06, 0.12, 0.2, 0.34, 0.48, 0.62, 1]

export const SCORE_TRACK_MARKS = [0.3, 0.6, 0.75, 0.85, 0.9, 0.95]

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function interpolate(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0]
  const last = xs.length - 1
  if (x >= xs[last]) return ys[last]
  for (let index = 0; index < last; index += 1) {
    const [x0, x1] = [xs[index], xs[index + 1]]
    if (x >= x0 && x <= x1) {
      const span = x1 - x0
      const ratio = span === 0 ? 0 : (x - x0) / span
      return ys[index] + ratio * (ys[index + 1] - ys[index])
    }
  }
  return ys[last]
}

/** 得分率 → 滑轨位置（0~1） */
export function ratioToTrack(ratio: number): number {
  return clamp(interpolate(clamp(ratio, 0, 0.95), RATIO_BREAKPOINTS, TRACK_BREAKPOINTS), 0, 1)
}

/** 滑轨位置（0~1） → 得分率 */
export function trackToRatio(track: number): number {
  return clamp(interpolate(clamp(track, 0, 1), TRACK_BREAKPOINTS, RATIO_BREAKPOINTS), 0, 0.95)
}

/** 目标分 → 滑轨刻度值（整数） */
export function scoreToTrackValue(score: number, paperTotal: number): number {
  if (paperTotal <= 0) return 0
  return Math.round(ratioToTrack(score / paperTotal) * SLIDER_RESOLUTION)
}

/** 滑轨刻度值 → 目标分（保留一位小数，与输入框步长一致） */
export function trackValueToScore(trackValue: number, paperTotal: number): number {
  const ratio = trackToRatio(trackValue / SLIDER_RESOLUTION)
  return Number((ratio * paperTotal).toFixed(1))
}

/** 每移动一格滑轨对应的分数变化，用于提示"该段有多细腻" */
export function trackStepForScore(score: number, paperTotal: number): number {
  const step = paperTotal / SLIDER_RESOLUTION
  if (paperTotal <= 0) return 0
  const ratio = clamp(score / paperTotal, 0, 0.95)
  const slope = Math.max(0.0001, ratioToTrack(Math.min(0.95, ratio + 0.005)) - ratioToTrack(ratio)) / 0.005
  return Number((step * (1 / Math.max(slope, 0.05))).toFixed(3))
}
