import { Prisma, type SettlementType } from '@prisma/client';
import { db } from './db';
import { localDate, localWeekday, scheduledInstant } from './time';

type Tx = Prisma.TransactionClient;
async function lockUser(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id = ${userId} AND active = true FOR UPDATE`;
  if (!rows.length) throw new Error('成员不存在或已停用');
}
async function balance(tx: Tx, userId: string) {
  return (await tx.pointTransaction.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount ?? 0;
}
async function ensureOpen(tx: Tx, userId: string, day: string) {
  if (await tx.dailySettlement.findUnique({ where: { userId_localDate: { userId, localDate: day } } })) throw new Error('今天已经结算');
}
export async function getBalance(userId: string) { return balance(db, userId); }
export async function completeAction(userId: string, actionId: string) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const now = new Date(), day = localDate(now);
    await ensureOpen(tx, userId, day);
    const action = await tx.action.findUnique({ where: { id: actionId }, include: { assignments: { where: { userId, enabled: true } }, steps: { where: { enabled: true } } } });
    if (!action?.enabled || !action.assignments.length || !action.repeatRule.split(',').includes(String(localWeekday(now)))) throw new Error('今天不能领取此行动');
    if (action.steps.length) throw new Error('请按顺序完成每一步');
    if (await tx.actionCompletion.findFirst({ where: { userId, actionId, localDate: day, reversedAt: null } })) throw new Error('今天已领取');
    const scheduledAt = action.scheduledTime ? scheduledInstant(day, action.scheduledTime) : null;
    const completion = await tx.actionCompletion.create({ data: { userId, actionId, localDate: day, scheduledAt, completedAt: now, startupLatencySeconds: scheduledAt ? Math.round((now.getTime() - scheduledAt.getTime()) / 1000) : null, pointsAwarded: action.points, actionNameSnapshot: action.name } });
    if (action.points > 0) await tx.pointTransaction.create({ data: { userId, amount: action.points, type: 'ACTION', sourceId: completion.id, sourceName: action.name, localDate: day } });
    return { completion, balance: await balance(tx, userId) };
  });
}
export async function completeActionStep(userId: string, actionId: string, stepId: string) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const now = new Date(), day = localDate(now);
    await ensureOpen(tx, userId, day);
    const action = await tx.action.findUnique({ where: { id: actionId }, include: { assignments: { where: { userId, enabled: true } }, steps: { where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } });
    if (!action?.enabled || !action.assignments.length || !action.repeatRule.split(',').includes(String(localWeekday(now)))) throw new Error('今天不能完成此行动');
    if (!action.steps.length) throw new Error('此行动没有步骤');
    if (await tx.actionCompletion.findFirst({ where: { userId, actionId, localDate: day, reversedAt: null } })) throw new Error('今天已完成整项行动');
    const previous = await tx.actionStepCompletion.findMany({ where: { userId, actionId, localDate: day, reversedAt: null }, orderBy: { completedAt: 'asc' } });
    const completedIds = new Set(previous.map(s => s.stepId));
    const next = action.steps.find(s => !completedIds.has(s.id));
    if (!next || next.id !== stepId) throw new Error('请从当前步骤继续，不能重复或跳步');
    const step = await tx.actionStepCompletion.create({ data: { userId, actionId, stepId, localDate: day, stepNameSnapshot: next.text, pointsAwarded: next.points, completedAt: now } });
    if (next.points > 0) await tx.pointTransaction.create({ data: { userId, amount: next.points, type: 'ACTION', sourceId: step.id, sourceName: `${action.name} · ${next.text}`, localDate: day } });
    const remaining = action.steps.find(s => s.id !== next.id && !completedIds.has(s.id));
    let completion = null;
    if (!remaining) {
      const scheduledAt = action.scheduledTime ? scheduledInstant(day, action.scheduledTime) : null;
      const startedAt = previous[0]?.completedAt || now;
      completion = await tx.actionCompletion.create({ data: { userId, actionId, localDate: day, scheduledAt, completedAt: now, startupLatencySeconds: scheduledAt ? Math.round((startedAt.getTime() - scheduledAt.getTime()) / 1000) : null, pointsAwarded: previous.reduce((n,s) => n+s.pointsAwarded, next.points), actionNameSnapshot: action.name } });
    }
    return { step, completion, nextStep: remaining ? { id: remaining.id, text: remaining.text } : null, balance: await balance(tx, userId) };
  });
}
export async function reverseCompletion(adminId: string, completionId: string) {
  const found = await db.actionCompletion.findUnique({ where: { id: completionId } });
  if (!found) throw new Error('记录不存在');
  return reverseActionProgress(adminId, found.userId, found.actionId, found.localDate);
}
export async function reverseActionProgress(adminId: string, userId: string, actionId: string, localDateOfProgress: string) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const day = localDate(); await ensureOpen(tx, userId, day);
    const [completion, steps, action] = await Promise.all([
      tx.actionCompletion.findFirst({ where: { userId, actionId, localDate: localDateOfProgress, reversedAt: null } }),
      tx.actionStepCompletion.findMany({ where: { userId, actionId, localDate: localDateOfProgress, reversedAt: null } }),
      tx.action.findUnique({ where: { id: actionId } })
    ]);
    if (!completion && !steps.length) throw new Error('进度已经撤销或不存在');
    const at = new Date();
    if (completion) await tx.actionCompletion.update({ where: { id: completion.id }, data: { reversedAt: at } });
    if (steps.length) await tx.actionStepCompletion.updateMany({ where: { userId, actionId, localDate: localDateOfProgress, reversedAt: null }, data: { reversedAt: at } });
    const amount = steps.length ? steps.reduce((n,s) => n+s.pointsAwarded,0) : completion?.pointsAwarded || 0;
    if (amount > 0) await tx.pointTransaction.create({ data: { userId, amount: -amount, type: 'REVERSAL', sourceId: completion?.id || steps[0].id, sourceName: completion?.actionNameSnapshot || action?.name || '行动', note: '撤销行动进度', createdByUserId: adminId, localDate: day } });
    return { balance: await balance(tx, userId) };
  });
}
export async function awardBonus(adminId: string, userId: string, bonusId: string, note = '') {
  return db.$transaction(async tx => {
    await lockUser(tx, userId); const day = localDate(); await ensureOpen(tx, userId, day);
    const rule = await tx.bonusRule.findUnique({ where: { id: bonusId } });
    if (!rule?.enabled) throw new Error('加分规则不可用');
    await tx.pointTransaction.create({ data: { userId, amount: rule.points, type: 'BONUS', sourceId: bonusId, sourceName: rule.name, note, createdByUserId: adminId, localDate: day } });
    return { balance: await balance(tx, userId) };
  });
}
export async function adjustPoints(adminId: string, userId: string, amount: number, note: string) {
  if (!Number.isInteger(amount) || !amount || !note.trim()) throw new Error('请输入非零整数和调整原因');
  return db.$transaction(async tx => {
    await lockUser(tx, userId); const day = localDate(); await ensureOpen(tx, userId, day);
    if (await balance(tx, userId) + amount < 0) throw new Error('调整后积分不能为负');
    await tx.pointTransaction.create({ data: { userId, amount, type: 'MANUAL_ADJUSTMENT', sourceName: '手工调整', note: note.trim(), createdByUserId: adminId, localDate: day } });
    return { balance: await balance(tx, userId) };
  });
}
export async function redeem(userId: string, rewardId: string) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId); const day = localDate(); await ensureOpen(tx, userId, day);
    const reward = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!reward?.enabled || reward.stock === 0) throw new Error('奖励目前不可兑换');
    if (!reward.repeatable && await tx.rewardRedemption.findFirst({ where: { userId, rewardId, status: { not: 'CANCELLED' } } })) throw new Error('此奖励只能兑换一次');
    if (await balance(tx, userId) < reward.cost) throw new Error('积分不足');
    if (reward.stock !== null) {
      const updated = await tx.reward.updateMany({ where: { id: rewardId, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
      if (updated.count !== 1) throw new Error('库存不足');
    }
    const item = await tx.rewardRedemption.create({ data: { userId, rewardId, rewardNameSnapshot: reward.name, costSnapshot: reward.cost } });
    await tx.pointTransaction.create({ data: { userId, amount: -reward.cost, type: 'REWARD_PURCHASE', sourceId: item.id, sourceName: reward.name, localDate: day } });
    return { item, balance: await balance(tx, userId) };
  });
}
export async function useReward(userId: string, redemptionId: string) {
  const result = await db.rewardRedemption.updateMany({ where: { id: redemptionId, userId, status: 'AVAILABLE' }, data: { status: 'USED', usedAt: new Date() } });
  if (result.count !== 1) throw new Error('奖励不存在或已经使用');
  return { ok: true };
}
export async function cancelRedemption(adminId: string, redemptionId: string) {
  return db.$transaction(async tx => {
    const item = await tx.rewardRedemption.findUnique({ where: { id: redemptionId } });
    if (!item) throw new Error('兑换不存在');
    await lockUser(tx, item.userId); const day = localDate(); await ensureOpen(tx, item.userId, day);
    const updated = await tx.rewardRedemption.updateMany({ where: { id: redemptionId, status: 'AVAILABLE' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (updated.count !== 1) throw new Error('只能取消未使用的奖励');
    await tx.pointTransaction.create({ data: { userId: item.userId, amount: item.costSnapshot, type: 'REVERSAL', sourceId: item.id, sourceName: item.rewardNameSnapshot, note: '取消兑换', createdByUserId: adminId, localDate: day } });
    const reward = await tx.reward.findUnique({ where: { id: item.rewardId } });
    if (reward?.stock !== null && reward) await tx.reward.update({ where: { id: item.rewardId }, data: { stock: { increment: 1 } } });
    return { balance: await balance(tx, item.userId) };
  });
}
export async function settle(userId: string, day: string, type: SettlementType) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T12:00:00Z`).toISOString().slice(0,10)!==day) throw new Error('结算日期无效');
  if (day > localDate()) throw new Error('不能结算未来日期');
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const prior = await tx.dailySettlement.findUnique({ where: { userId_localDate: { userId, localDate: day } } });
    if (prior) return prior;
    const threshold = Number((await tx.setting.findUnique({ where: { key: 'dailyBonusThreshold' } }))?.value || 0);
    const bonus = Number((await tx.setting.findUnique({ where: { key: 'dailyBonusPoints' } }))?.value || 0);
    const transactions = await tx.pointTransaction.findMany({ where: { userId, localDate: day } });
    const earnedBefore = transactions.filter(t => t.amount > 0).reduce((n,t) => n+t.amount,0);
    if (threshold > 0 && bonus > 0 && earnedBefore >= threshold && !transactions.some(t => t.type === 'DAILY_BONUS')) {
      const daily = await tx.pointTransaction.create({ data: { userId, amount: bonus, type: 'DAILY_BONUS', sourceName: '每日奖励', localDate: day } });
      transactions.push(daily);
    }
    const sum = (kind: string) => transactions.filter(t => t.type === kind).reduce((n,t) => n+t.amount,0);
    const earnedPoints = transactions.filter(t => t.amount > 0).reduce((n,t) => n+t.amount,0);
    const spentPoints = -transactions.filter(t => t.amount < 0).reduce((n,t) => n+t.amount,0);
    const netPoints = earnedPoints-spentPoints;
    const before = await tx.pointTransaction.aggregate({ where: { userId, localDate: { lt: day } }, _sum: { amount: true } });
    const completedActionCount = await tx.actionCompletion.count({ where: { userId, localDate: day, reversedAt: null } });
    return tx.dailySettlement.create({ data: { userId, localDate: day, completedActionCount, actionPoints: sum('ACTION'), bonusPoints: sum('BONUS'), dailyBonusPoints: sum('DAILY_BONUS'), earnedPoints, spentPoints, netPoints, openingBalance: before._sum.amount || 0, closingBalance: (before._sum.amount || 0)+netPoints, settlementType: type } });
  });
}
export async function lazySettle(userId: string) {
  const today = localDate();
  const owner = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!owner) return;
  const existing = new Set((await db.dailySettlement.findMany({ where: { userId, localDate: { lt: today } }, select: { localDate: true } })).map(s => s.localDate));
  let day = localDate(owner.createdAt);
  for (let n=0; day < today && n<3660; n++, day=nextLocalDate(day)) if (!existing.has(day)) await settle(userId, day, 'AUTO');
}
function nextLocalDate(day: string) { return new Date(Date.parse(`${day}T12:00:00Z`) + 86400_000).toISOString().slice(0,10); }
export async function todayData(userId: string) {
  const day = localDate(); const weekday = String(localWeekday());
  const [actions, completions, stepCompletions, points, total] = await Promise.all([
    db.action.findMany({ where: { enabled: true, assignments: { some: { userId, enabled: true } } }, include: { steps: { where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } }, orderBy: { sortOrder: 'asc' } }),
    db.actionCompletion.findMany({ where: { userId, localDate: day, reversedAt: null } }),
    db.actionStepCompletion.findMany({ where: { userId, localDate: day, reversedAt: null } }),
    db.pointTransaction.findMany({ where: { userId, localDate: day } }), getBalance(userId)
  ]);
  const visible=actions.filter(a=>a.repeatRule.split(',').includes(weekday));
  return { date: day, balance: total, earned: points.filter(t=>t.amount>0).reduce((n,t)=>n+t.amount,0), completed: completions.filter(c=>visible.some(a=>a.id===c.actionId)).length, actions: visible.map(a=>{const done=completions.some(c=>c.actionId===a.id);const completedSteps=stepCompletions.filter(s=>s.actionId===a.id&&a.steps.some(step=>step.id===s.stepId));const completedIds=new Set(completedSteps.map(s=>s.stepId));return { ...a, done, progressCount:completedSteps.length, stepCount:a.steps.length, currentStep:done?null:a.steps.find(s=>!completedIds.has(s.id))||null };}), settled: !!await db.dailySettlement.findUnique({ where: { userId_localDate: { userId, localDate: day } } }) };
}
