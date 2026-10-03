import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { currentUser, login, logout } from '@/lib/auth';
import { adjustPoints, awardBonus, cancelRedemption, completeAction, getBalance, lazySettle, redeem, reverseCompletion, settle, todayData, useReward } from '@/lib/core';
import { localDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const str = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const int = (v: unknown) => Number.isInteger(Number(v)) ? Number(v) : NaN;
const bool = (v: unknown) => v === true;
function originOK(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const expected = process.env.APP_ORIGIN;
  return expected ? origin === expected : origin === req.nextUrl.origin;
}
async function body(req: NextRequest) { return await req.json().catch(() => ({})) as Record<string,unknown>; }
type Context = { params: Promise<{path:string[]}> };
async function handler(req: NextRequest, ctx: Context) {
  const path = (await ctx.params).path;
  const key = path.join('/');
  const method = req.method;
  if (method !== 'GET' && !originOK(req)) return fail('请求来源不受信任', 403);
  try {
    if (key === 'auth/login' && method === 'POST') {
      const b = await body(req);
      return NextResponse.json(await login(str(b.username,80), str(b.password,200)));
    }
    if (key === 'auth/logout' && method === 'POST') { await logout(); return NextResponse.json({ok:true}); }
    const user = await currentUser();
    if (!user) return fail('请先登录', 401);
    if (key === 'auth/me' && method === 'GET') return NextResponse.json(user);
    if (key === 'today' && method === 'GET') { await lazySettle(user.id); return NextResponse.json(await todayData(user.id)); }
    if (key === 'actions/complete' && method === 'POST') return NextResponse.json(await completeAction(user.id, str((await body(req)).actionId)));
    if (key === 'points' && method === 'GET') {
      await lazySettle(user.id);
      const transactions = await db.pointTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt:'desc' } });
      return NextResponse.json({ today:localDate(), balance: await getBalance(user.id), transactions });
    }
    if (key === 'rewards' && method === 'GET') return NextResponse.json(await db.reward.findMany({ where: { enabled:true }, orderBy: { sortOrder:'asc' } }));
    if (key === 'rewards/redeem' && method === 'POST') return NextResponse.json(await redeem(user.id, str((await body(req)).rewardId)));
    if (key === 'rewards/mine' && method === 'GET') return NextResponse.json(await db.rewardRedemption.findMany({ where: { userId:user.id }, orderBy: { redeemedAt:'desc' } }));
    if (key === 'rewards/use' && method === 'POST') return NextResponse.json(await useReward(user.id, str((await body(req)).redemptionId)));
    if (key === 'history' && method === 'GET') {
      await lazySettle(user.id);
      const [settlements, completions, transactions] = await Promise.all([
        db.dailySettlement.findMany({ where: { userId:user.id }, orderBy: { localDate:'desc' } }),
        db.actionCompletion.findMany({ where: { userId:user.id, startupLatencySeconds: { not:null } }, orderBy: { completedAt:'desc' }, take: 100, select: { localDate:true, startupLatencySeconds:true, actionNameSnapshot:true } }),
        db.pointTransaction.findMany({ where: { userId:user.id }, orderBy: { createdAt:'desc' } })
      ]);
      return NextResponse.json({ settlements, completions, transactions });
    }
    if (user.role !== 'ADMIN') return fail('无权限',403);
    if (key === 'admin/overview' && method === 'GET') {
      const users = await db.user.findMany({ where: { active:true }, select: { id:true, username:true, role:true } });
      const today = localDate();
      return NextResponse.json(await Promise.all(users.map(async u => ({ ...u, balance:await getBalance(u.id), completed:await db.actionCompletion.count({ where: { userId:u.id, localDate:today, reversedAt:null } }) }))));
    }
    if (key === 'admin/users') {
      if (method === 'GET') return NextResponse.json(await db.user.findMany({ select: { id:true, username:true, role:true, active:true, createdAt:true }, orderBy: { createdAt:'asc' } }));
      const b = await body(req);
      if (method === 'POST') {
        const username = str(b.username,80), password = str(b.password,200);
        if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(username) || password.length < 12) throw new Error('用户名需 3 位以上；密码至少 12 位');
        return NextResponse.json(await db.user.create({ data: { username, passwordHash:await bcrypt.hash(password,12), role:b.role==='ADMIN'?'ADMIN':'MEMBER' }, select: { id:true,username:true,role:true } }));
      }
      if (method === 'PATCH') {
        const id=str(b.id), target=await db.user.findUnique({ where:{id} });
        if (!target) throw new Error('成员不存在');
        if (id===user.id && (b.active===false || b.role==='MEMBER')) throw new Error('不能停用或降级当前管理员');
        const password=str(b.password,200);
        if (password && password.length < 12) throw new Error('新密码至少 12 位');
        return NextResponse.json(await db.user.update({ where:{id}, data:{ active: typeof b.active==='boolean'?b.active:undefined, role:b.role==='ADMIN'?'ADMIN':b.role==='MEMBER'?'MEMBER':undefined, passwordHash:password?await bcrypt.hash(password,12):undefined }, select: { id:true,username:true,role:true,active:true } }));
      }
    }
    if (key === 'admin/actions') {
      if (method==='GET') return NextResponse.json(await db.action.findMany({ include:{assignments:true}, orderBy:{sortOrder:'asc'} }));
      const b=await body(req), points=int(b.points);
      if (!str(b.name) || !Number.isInteger(points) || points<0 || points>10000) throw new Error('行动名称或积分无效');
      const data={ name:str(b.name), icon:str(b.icon,10)||'✨', description:str(b.description,500), firstStep:str(b.firstStep,300), points, scheduledTime:str(b.scheduledTime,5)||null, repeatRule:str(b.repeatRule,30)||'0,1,2,3,4,5,6', reminderEnabled:bool(b.reminderEnabled), reminderBeforeMinutes:int(b.reminderBeforeMinutes)||10, transitionEnabled:bool(b.transitionEnabled), transitionDurationMinutes:int(b.transitionDurationMinutes)||5, transitionInstruction:str(b.transitionInstruction,300), enabled:b.enabled!==false, sortOrder:int(b.sortOrder)||0 };
      if (data.scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.scheduledTime)) throw new Error('计划时间格式须为 HH:mm');
      if (method==='POST') return NextResponse.json(await db.action.create({ data:{...data,createdBy:user.id} }));
      if (method==='PATCH') return NextResponse.json(await db.action.update({ where:{id:str(b.id)},data }));
    }
    if (key === 'admin/assign' && method==='POST') {
      const b=await body(req), actionId=str(b.actionId), userId=str(b.userId);
      return NextResponse.json(await db.actionAssignment.upsert({ where:{actionId_userId:{actionId,userId}},create:{actionId,userId,enabled:b.enabled!==false},update:{enabled:b.enabled!==false} }));
    }
    if (key === 'admin/reverse' && method==='POST') return NextResponse.json(await reverseCompletion(user.id,str((await body(req)).completionId)));
    if (key === 'admin/bonus') {
      if (method==='GET') return NextResponse.json(await db.bonusRule.findMany({orderBy:{sortOrder:'asc'}}));
      const b=await body(req), points=int(b.points);
      if (!str(b.name) || !Number.isInteger(points) || points<=0) throw new Error('规则名称或积分无效');
      const data={name:str(b.name),icon:str(b.icon,10)||'✨',points,enabled:b.enabled!==false,sortOrder:int(b.sortOrder)||0};
      if (method==='POST') return NextResponse.json(await db.bonusRule.create({data}));
      if (method==='PATCH') return NextResponse.json(await db.bonusRule.update({where:{id:str(b.id)},data}));
    }
    if (key === 'admin/bonus/award' && method==='POST') { const b=await body(req); return NextResponse.json(await awardBonus(user.id,str(b.userId),str(b.bonusId),str(b.note,500))); }
    if (key === 'admin/rewards') {
      if (method==='GET') return NextResponse.json(await db.reward.findMany({orderBy:{sortOrder:'asc'}}));
      const b=await body(req), cost=int(b.cost), stock=b.stock===''||b.stock===null||b.stock===undefined?null:int(b.stock);
      if (!str(b.name) || !Number.isInteger(cost) || cost<=0 || (stock!==null && (!Number.isInteger(stock)||stock<0))) throw new Error('奖励名称、价格或库存无效');
      const data={name:str(b.name),icon:str(b.icon,10)||'🎁',description:str(b.description,500),cost,enabled:b.enabled!==false,repeatable:b.repeatable!==false,stock,sortOrder:int(b.sortOrder)||0};
      if (method==='POST') return NextResponse.json(await db.reward.create({data}));
      if (method==='PATCH') return NextResponse.json(await db.reward.update({where:{id:str(b.id)},data}));
    }
    if (key === 'admin/rewards/cancel' && method==='POST') return NextResponse.json(await cancelRedemption(user.id,str((await body(req)).redemptionId)));
    if (key === 'admin/adjust' && method==='POST') { const b=await body(req); return NextResponse.json(await adjustPoints(user.id,str(b.userId),int(b.amount),str(b.note,500))); }
    if (key === 'admin/settlements') {
      if (method==='GET') return NextResponse.json(await db.dailySettlement.findMany({include:{user:{select:{username:true}}},orderBy:{localDate:'desc'},take:200}));
      if (method==='POST') { const b=await body(req); return NextResponse.json(await settle(str(b.userId),str(b.localDate,10)||localDate(),'MANUAL')); }
    }
    if (key === 'admin/settings') {
      if (method==='GET') return NextResponse.json(await db.setting.findMany());
      if (method==='PATCH') {
        const b=await body(req);
        for (const k of ['settlementTime','dailyBonusThreshold','dailyBonusPoints']) if (b[k]!==undefined) {
          const value=str(b[k],20);
          if (k==='settlementTime' ? !/^([01]\d|2[0-3]):[0-5]\d$/.test(value) : !/^\d+$/.test(value)) throw new Error('设置值无效');
          await db.setting.upsert({where:{key:k},create:{key:k,value},update:{value}});
        }
        return NextResponse.json(await db.setting.findMany());
      }
    }
    if (key === 'admin/completions' && method==='GET') return NextResponse.json(await db.actionCompletion.findMany({include:{user:{select:{username:true}}},orderBy:{completedAt:'desc'},take:200}));
    if (key === 'admin/redemptions' && method==='GET') return NextResponse.json(await db.rewardRedemption.findMany({include:{user:{select:{username:true}}},orderBy:{redeemedAt:'desc'},take:200}));
    if (key === 'admin/export' && method==='GET') {
      const kind=req.nextUrl.searchParams.get('kind');
      let rows: (string|number|null)[][]=[], header: string[]=[];
      if (kind==='transactions') {
        header=['DateTime','User','Type','Source','Amount','Note'];
        rows=(await db.pointTransaction.findMany({include:{user:{select:{username:true}}},orderBy:{createdAt:'asc'}})).map(t=>[t.createdAt.toISOString(),t.user.username,t.type,t.sourceName,t.amount,t.note]);
      } else if (kind==='actions') {
        header=['Date','User','Action','ScheduledTime','CompletedTime','StartupLatency','Points'];
        rows=(await db.actionCompletion.findMany({include:{user:{select:{username:true}}},orderBy:{completedAt:'asc'}})).map(c=>[c.localDate,c.user.username,c.actionNameSnapshot,c.scheduledAt?.toISOString()||'',c.completedAt.toISOString(),c.startupLatencySeconds,c.pointsAwarded]);
      } else if (kind==='settlements') {
        header=['Date','User','ActionPoints','BonusPoints','Earned','Spent','Net','ClosingBalance'];
        rows=(await db.dailySettlement.findMany({include:{user:{select:{username:true}}},orderBy:{localDate:'asc'}})).map(s=>[s.localDate,s.user.username,s.actionPoints,s.bonusPoints,s.earnedPoints,s.spentPoints,s.netPoints,s.closingBalance]);
      } else return fail('导出类型无效');
      const escape=(v:string|number|null)=>{let value=String(v??'');if(/^[\s]*[=+\-@]/.test(value))value="'"+value;return `"${value.replaceAll('"','""')}"`;};
      const csv='\uFEFF'+[header,...rows].map(row=>row.map(escape).join(',')).join('\r\n');
      return new NextResponse(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${kind}.csv"`}});
    }
    return fail('接口不存在',404);
  } catch (e) {
    const message=e instanceof Error?e.message:'操作失败';
    return fail(message,/无权限/.test(message)?403:400);
  }
}
export const GET=handler, POST=handler, PATCH=handler;
