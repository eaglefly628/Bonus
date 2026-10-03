import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { localDate, localHourMinute } from '@/lib/time';
import { lazySettle, settle } from '@/lib/core';

export async function POST(req:NextRequest) {
  const expected=process.env.CRON_SECRET||'';
  const actual=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if (!expected || Buffer.byteLength(expected)!==Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected),Buffer.from(actual))) return NextResponse.json({error:'Unauthorized'},{status:401});
  const cutoff=(await db.setting.findUnique({where:{key:'settlementTime'}}))?.value||'22:30';
  await db.loginAttempt.deleteMany({where:{createdAt:{lt:new Date(Date.now()-24*3600_000)}}});
  const today=localDate(), now=localHourMinute();
  const users=await db.user.findMany({where:{active:true},select:{id:true}});
  for (const user of users) {
    await lazySettle(user.id);
    if (now>=cutoff) await settle(user.id,today,'AUTO');
  }
  return NextResponse.json({ok:true,processed:users.length});
}
