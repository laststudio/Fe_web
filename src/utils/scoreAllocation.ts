/**
 * 分值分配的加权随机模型（与后端 auto_complete/scoring.py 保持一致）。
 *
 * 现实考卷的失分不是"每道题平均扣一点"，而是：
 *   · 少数几道题明显低（读错、漏读、卡壳）——本次的"失误题"；
 *   · 其余题目接近满分，小分值题经常直接满分；
 *   · 长句子/高分值题几乎不会满分（大分值题至少扣一档）；
 *   · 读得越好（目标分越高），失误题越少、每题扣得越轻、分布越收紧。
 *
 * 权重只看官方逐题满分（不猜题型、不写死地区卷面），所以 30 分、40 分、
 * 100 分卷都自动适配；最终用最大余数法配平，Σ 实得恒等于设定总分。
 *
 * 前端只用它做"示意预览"，真正上报的分配由后端每次运行独立随机生成。
 */

export const GRADUATION = 0.125

const LOSS_PROPENSITY_EXPONENT = 0.85
const LOSS_MISTAKE_EXPONENT = 1.8
const BIG_QUESTION_SHARE = 0.15

export type QuestionAllocation = {
  /** 卷面满分 */
  maxScore: number
  /** 计划实际得分（档位对齐） */
  allocatedScore: number
  /** 是否满分 */
  isFull: boolean
  /** 是否大分值题（长句子朗读这类，几乎不满分） */
  isBigQuestion: boolean
  /** 本次被扣掉的档位数（1 档 = 0.125 分） */
  lossSlots: number
  /** 相对扣分比例 0~1 */
  lossRatio: number
}

type Rng = () => number

/** 确定性 PRNG：同一个 seed 预览结果稳定，换 seed 就是"换一批"。 */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: Rng): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function lossCapRatio(targetRate: number): number {
  if (targetRate >= 93) return 0.25
  if (targetRate >= 88) return 0.35
  if (targetRate >= 78) return 0.5
  return 0.7
}

function lossJitterSigma(deductionRatio: number): number {
  return 0.26 + 0.45 * deductionRatio
}

function mistakeCount(lossSlots: number, avgMaxSlots: number, questionCount: number): number {
  if (lossSlots <= 0 || avgMaxSlots <= 0) return 0
  const raw = 1 + (lossSlots / avgMaxSlots) * 1.55
  const capped = Math.max(1, Math.round(questionCount * 0.6))
  return Math.max(1, Math.min(questionCount, Math.round(raw), capped))
}

function sampleWeighted(rng: Rng, weights: number[], count: number): number[] {
  const pool = weights.map((_, index) => index)
  const picked: number[] = []
  const target = Math.max(0, Math.min(count, pool.length))
  for (let taken = 0; taken < target; taken += 1) {
    const total = pool.reduce((sum, index) => sum + weights[index], 0)
    if (total <= 0) {
      picked.push(pool.shift() as number)
      continue
    }
    const threshold = rng() * total
    let running = 0
    let chosen = pool[pool.length - 1]
    for (const index of pool) {
      running += weights[index]
      if (running >= threshold) {
        chosen = index
        break
      }
    }
    picked.push(chosen)
    pool.splice(pool.indexOf(chosen), 1)
  }
  return picked
}

function allocateLossSlots(
  fullPoints: number[],
  lossSlots: number,
  maxSlots: number[],
  targetRate: number,
  rng: Rng
): number[] {
  const n = fullPoints.length
  if (n <= 0 || lossSlots <= 0) return new Array(n).fill(0)

  const totalFull = fullPoints.reduce((sum, point) => sum + Math.max(0, point), 0)
  if (totalFull <= 0) return new Array(n).fill(0)
  const share = fullPoints.map((point) => Math.max(0, point) / totalFull)
  const propensity = share.map((value) => Math.max(value, 1e-6) ** LOSS_PROPENSITY_EXPONENT)
  const mistakeBias = share.map((value) => Math.max(value, 1e-6) ** LOSS_MISTAKE_EXPONENT)

  const totalMaxSlots = maxSlots.reduce((sum, slot) => sum + slot, 0) || 1
  const deductionRatio = lossSlots / totalMaxSlots
  const sigma = lossJitterSigma(deductionRatio)

  const rounds = mistakeCount(lossSlots, totalMaxSlots / n, n)
  const bigIndices = share
    .map((value, index) => (value >= BIG_QUESTION_SHARE ? index : -1))
    .filter((index) => index >= 0)

  const mistakes = new Set<number>()
  if (bigIndices.length > 0 && deductionRatio <= 0.4 && lossSlots >= bigIndices.length) {
    bigIndices.forEach((index) => mistakes.add(index))
    const extra = Math.max(0, rounds - mistakes.size)
    const others = share.map((_, index) => index).filter((index) => !mistakes.has(index))
    if (extra > 0 && others.length > 0) {
      const picked = sampleWeighted(rng, others.map((index) => mistakeBias[index]), extra)
      picked.forEach((position) => mistakes.add(others[position]))
    }
  } else {
    sampleWeighted(rng, mistakeBias, rounds).forEach((index) => mistakes.add(index))
  }

  const mistakeShare = deductionRatio <= 0.15 ? 0.9 : deductionRatio <= 0.3 ? 0.82 : 0.7
  const mistakeWeight = Array.from(mistakes).reduce((sum, index) => sum + propensity[index], 0) || 1
  const ordinary = share.map((_, index) => index).filter((index) => !mistakes.has(index))

  let ideal = fullPoints.map((_, index) => {
    let base: number
    if (mistakes.has(index)) {
      base = (lossSlots * mistakeShare * propensity[index]) / mistakeWeight
    } else if (ordinary.length > 0) {
      base = (lossSlots * (1 - mistakeShare)) / ordinary.length
    } else {
      base = 0
    }
    return sigma > 0 ? base * Math.exp(sigma * gaussian(rng)) : base
  })
  const idealSum = ideal.reduce((sum, value) => sum + value, 0)
  if (idealSum > 0) {
    const rescale = lossSlots / idealSum
    ideal = ideal.map((value) => value * rescale)
  }

  const capRatio = lossCapRatio(targetRate)
  const headroom = maxSlots.map((slot) => Math.max(0, slot - 1))
  const caps = maxSlots.map((slot, index) =>
    Math.max(0, Math.min(headroom[index], Math.floor(slot * capRatio)))
  )
  const loss = ideal.map((value, index) => Math.max(0, Math.min(caps[index], Math.floor(value))))
  let remaining = lossSlots - loss.reduce((sum, value) => sum + value, 0)

  const pickVictim = (): number => {
    let bestIndex = -1
    let bestResidual: number | null = null
    for (let index = 0; index < n; index += 1) {
      if (loss[index] >= caps[index]) continue
      const residual = ideal[index] - loss[index]
      if (bestResidual === null || residual > bestResidual) {
        bestIndex = index
        bestResidual = residual
      }
    }
    return bestIndex
  }

  while (remaining > 0) {
    const victim = pickVictim()
    if (victim < 0) {
      let relaxed = false
      for (let index = 0; index < n; index += 1) {
        if (caps[index] < headroom[index]) {
          caps[index] = headroom[index]
          relaxed = true
        }
      }
      if (!relaxed) {
        for (let index = 0; index < n; index += 1) {
          if (caps[index] < maxSlots[index]) {
            caps[index] = Math.max(0, maxSlots[index])
            relaxed = true
          }
        }
      }
      if (!relaxed) break
      continue
    }
    loss[victim] += 1
    remaining -= 1
  }

  // 大分值题在条件允许时至少扣一档：长句子几乎不可能是满分
  if (bigIndices.length > 0 && lossSlots >= bigIndices.length) {
    for (const index of bigIndices) {
      if (loss[index] > 0 || caps[index] < 1) continue
      const donors = loss
        .map((value, other) => ({ value, other }))
        .filter(
          ({ value, other }) =>
            other !== index &&
            (value >= 2 || (value >= 1 && share[other] < BIG_QUESTION_SHARE))
        )
      if (donors.length === 0) continue
      const donor = donors.reduce((best, item) => (item.value > best.value ? item : best))
      loss[donor.other] -= 1
      loss[index] += 1
    }
  }

  return loss
}

/**
 * 生成一份"示意分配"：Σ 计划得分 ≡ 设定总分，形态与后端一致。
 * 前端预览用固定 seed 保证渲染稳定，点"换一批"换 seed 即可重新抽样。
 */
export function planQuestionAllocations(
  fullPoints: number[],
  targetTotal: number,
  seed = 20250928
): QuestionAllocation[] {
  const n = fullPoints.length
  if (n === 0) return []
  const maxSlots = fullPoints.map((point) =>
    GRADUATION > 0 ? Math.ceil(Math.max(0, point) / GRADUATION) : 0
  )
  const totalMaxSlots = maxSlots.reduce((sum, slot) => sum + slot, 0)
  const totalFull = fullPoints.reduce((sum, point) => sum + Math.max(0, point), 0)
  if (totalFull <= 0) {
    return fullPoints.map((point) => ({
      maxScore: point,
      allocatedScore: 0,
      isFull: false,
      isBigQuestion: false,
      lossSlots: 0,
      lossRatio: 0,
    }))
  }
  const rate = (Math.max(0, Math.min(targetTotal, totalFull)) / totalFull) * 100
  let targetSlots = Math.round((totalFull * rate) / 100 / GRADUATION)
  targetSlots = Math.max(0, Math.min(totalMaxSlots, targetSlots))

  const rng = createRng(seed)
  const loss = allocateLossSlots(
    fullPoints,
    totalMaxSlots - targetSlots,
    maxSlots,
    rate,
    rng
  )

  return fullPoints.map((point, index) => {
    const slots = Math.max(0, maxSlots[index] - loss[index])
    const allocated = Number((slots * GRADUATION).toFixed(2))
    const full = Number(point.toFixed(2))
    return {
      maxScore: full,
      allocatedScore: allocated,
      isFull: Math.abs(allocated - full) < 1e-9,
      isBigQuestion: totalFull > 0 && point / totalFull >= BIG_QUESTION_SHARE,
      lossSlots: loss[index],
      lossRatio: full > 0 ? Math.max(0, 1 - allocated / full) : 0,
    }
  })
}

/** 与后端一致的档位换算（仅用于展示 5 分制折算）。 */
export function toFiveScale(allocated: number, maxScore: number): number {
  if (maxScore <= 0) return 5
  return Number(((allocated / maxScore) * 5).toFixed(2))
}
