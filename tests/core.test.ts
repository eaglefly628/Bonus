import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { completeAction, completeActionStep, redeem, getBalance, reverseActionProgress, reverseCompletion, settle, todayData, useReward } from '../src/lib/core';
import { localDate, scheduledInstant } from '../src/lib/time';

if (!process.env.DATABASE_URL?.includes('actionpoints_test')) throw new Error('测试只能连接名称含 actionpoints_test 的独立数据库');
let adminId='', userId='', actionId='', rewardId='';
before(async()=>{
  await db.$executeRawUnsafe('TRUNCATE TABLE "Session","LoginAttempt","ActionAssignment","ActionCompletion","PointTransaction","RewardRedemption","DailySettlement","Action","BonusRule","Reward","Setting","User" CASCADE');
  adminId=(await db.user.create({data:{username:'test-admin',passwordHash:'x',role:'ADMIN'}})).id;
  userId=(await db.user.create({data:{username:'test-member',passwordHash:'x'}})).id;
  actionId=(await db.action.create({data:{name:'Test action',points:10}})).id;
  await db.actionAssignment.create({data:{userId,actionId}});
  rewardId=(await db.reward.create({data:{name:'Test reward',cost:15,stock:1}})).id;
});
after(async()=>{await db.$disconnect();});
test('同一行动并发完成只加一次分',async()=>{
  const results=await Promise.allSettled([completeAction(userId,actionId),completeAction(userId,actionId)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await getBalance(userId),10);
});
test('余额不足及并发兑换不会双花',async()=>{
  await assert.rejects(redeem(userId,rewardId));
  await db.pointTransaction.create({data:{userId,amount:20,type:'MANUAL_ADJUSTMENT',sourceName:'Test',localDate:localDate(),createdByUserId:adminId}});
  const results=await Promise.allSettled([redeem(userId,rewardId),redeem(userId,rewardId)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await getBalance(userId),15);
  const item=await db.rewardRedemption.findFirstOrThrow({where:{userId}});
  assert.equal(item.costSnapshot,15);
  await useReward(userId,item.id);
  await assert.rejects(useReward(userId,item.id));
});
test('撤销保留原流水，余额一致',async()=>{
  const completion=await db.actionCompletion.findFirstOrThrow({where:{userId}});
  await reverseCompletion(adminId,completion.id);
  assert.equal(await getBalance(userId),5);
  await assert.rejects(reverseCompletion(adminId,completion.id));
});
test('结算和每日奖励幂等',async()=>{
  await db.setting.createMany({data:[{key:'dailyBonusThreshold',value:'5'},{key:'dailyBonusPoints',value:'2'}]});
  const day=localDate();
  const first=await settle(userId,day,'MANUAL');
  const second=await settle(userId,day,'AUTO');
  assert.equal(first.id,second.id);
  assert.equal(await db.pointTransaction.count({where:{userId,localDate:day,type:'DAILY_BONUS'}}),1);
  assert.equal(await getBalance(userId),7);
});
test('Pattern 逐步推进，不能跳步或重复，撤销后积分一致',async()=>{
  const member=await db.user.create({data:{username:'step-member',passwordHash:'x'}});
  const action=await db.action.create({data:{name:'做作业',points:3,steps:{create:[{text:'坐好',points:1,sortOrder:0},{text:'拿出作业',points:0,sortOrder:1},{text:'开始做',points:2,sortOrder:2}]}}});
  await db.actionAssignment.create({data:{userId:member.id,actionId:action.id}});
  const steps=await db.actionStep.findMany({where:{actionId:action.id},orderBy:{sortOrder:'asc'}});
  await assert.rejects(completeAction(member.id,action.id),/按顺序/);
  await assert.rejects(completeActionStep(member.id,action.id,steps[1].id),/不能重复或跳步/);
  const first=await Promise.allSettled([completeActionStep(member.id,action.id,steps[0].id),completeActionStep(member.id,action.id,steps[0].id)]);
  assert.equal(first.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await todayData(member.id)).actions.find(a=>a.id===action.id)?.currentStep?.id,steps[1].id);
  await completeActionStep(member.id,action.id,steps[1].id);
  assert.equal(await getBalance(member.id),1);
  const last=await completeActionStep(member.id,action.id,steps[2].id);
  assert.ok(last.completion);
  assert.equal(last.nextStep,null);
  assert.equal(await getBalance(member.id),3);
  await assert.rejects(completeActionStep(member.id,action.id,steps[2].id),/已完成/);
  await reverseActionProgress(adminId,member.id,action.id,localDate());
  assert.equal(await getBalance(member.id),0);
  assert.equal((await todayData(member.id)).actions.find(a=>a.id===action.id)?.progressCount,0);
});
test('本地日期与计划时间使用指定时区',()=>{
  assert.equal(localDate(new Date('2026-01-01T16:30:00Z'),'Asia/Shanghai'),'2026-01-02');
  assert.equal(scheduledInstant('2026-01-02','19:00','Asia/Shanghai')?.toISOString(),'2026-01-02T11:00:00.000Z');
});
