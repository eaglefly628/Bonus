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
    const action = await tx.action.findUnique({ where: { id: actionId }, include: { assignments: { where: { userId, enabled: true } } } });
    if (!action?.enabled || !action.assignments.length || !action.repeatRule.split(',').includes(String(localWeekday(now)))) throw new Error('今天不能领取此行动');
    if (await tx.actionCompletion.findFirst({ where: { userId, actionId, localDate: day, reversedAt: null } })) throw new Error('今天已领取');
    const scheduledAt = action.scheduledTime ? scheduledInstant(day, action.scheduledTime) : null;
    const completion = await tx.actionCompletion.create({ data: { userId, actionId, localDate: day, scheduledAt, completedAt: now, startupLatencySeconds: scheduledAt ? Math.round((now.getTime() - scheduledAt.getTime()) / 1000) : null, pointsAwarded: action.points, actionNameSnapshot: action.name } });
    if (action.points > 0) await tx.pointTransaction.create({ data: { userId, amount: action.points, type: 'ACTION', sourceId: completion.id, sourceName: action.name, localDate: day } });
    return { completion, balance: await balance(tx, userId) };
  });
}
export async function reverseCompletion(adminId: string, completionId: string) {
  return db.$transaction(async tx => {
    const found = await tx.actionCompletion.findUnique({ where: { id: completionId } });
    if (!found) throw new Error('记录不存在');
    await lockUser(tx, found.userId);
    const day = localDate(); await ensureOpen(tx, found.userId, day);
    const result = await tx.actionCompletion.updateMany({ where: { id: completionId, reversedAt: null }, data: { reversedAt: new Date() } });
    if (result.count !== 1) throw new Error('已经撤销');
    if (found.pointsAwarded > 0) await tx.pointTransaction.create({ data: { userId: found.userId, amount: -found.pointsAwarded, type: 'REVERSAL', sourceId: completionId, sourceName: found.actionNameSnapshot, note: '撤销行动完成', createdByUserId: adminId, localDate: day } });
    return { balance: await balance(tx, found.userId) };
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
  const [actions, completions, points, total] = await Promise.all([
    db.action.findMany({ where: { enabled: true, assignments: { some: { userId, enabled: true } } }, orderBy: { sortOrder: 'asc' } }),
    db.actionCompletion.findMany({ where: { userId, localDate: day, reversedAt: null } }),
    db.pointTransaction.findMany({ where: { userId, localDate: day } }), getBalance(userId)
  ]);
  return { date: day, balance: total, earned: points.filter(t=>t.amount>0).reduce((n,t)=>n+t.amount,0), completed: completions.length, actions: actions.filter(a=>a.repeatRule.split(',').includes(weekday)).map(a=>({ ...a, done: completions.some(c=>c.actionId===a.id) })), settled: !!await db.dailySettlement.findUnique({ where: { userId_localDate: { userId, localDate: day } } }) };
}
