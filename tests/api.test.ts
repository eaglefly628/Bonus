import { test } from 'node:test';
import assert from 'node:assert/strict';

const base=process.env.TEST_BASE_URL;
const username=process.env.TEST_MEMBER_USERNAME;
const password=process.env.TEST_MEMBER_PASSWORD;
test('成员无法访问管理员数据，且积分接口只返回本人流水',{skip:!base||!username||!password},async()=>{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':base!},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const admin=await fetch(base+'/api/admin/users',{headers:{Cookie:cookie}});
  assert.equal(admin.status,403);
  const points=await fetch(base+'/api/points',{headers:{Cookie:cookie}});
  assert.equal(points.status,200);
  const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}});
  const user=await me.json();
  const ledger=await points.json();
  assert.ok(ledger.transactions.every((t:{userId:string})=>t.userId===user.id));
});
