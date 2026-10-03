import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, localWeekday, previousLocalDate, scheduledInstant } from '../src/lib/time';

test('跨 UTC 日期使用家庭时区',()=>{
  const instant=new Date('2026-01-01T16:30:00Z');
  assert.equal(localDate(instant,'Asia/Shanghai'),'2026-01-02');
  assert.equal(localWeekday(instant,'Asia/Shanghai'),5);
});
test('计划时间转换为正确的 UTC 时间',()=>{
  assert.equal(scheduledInstant('2026-01-02','19:00','Asia/Shanghai')?.toISOString(),'2026-01-02T11:00:00.000Z');
  assert.equal(scheduledInstant('2026-01-02','25:00','Asia/Shanghai'),null);
});
test('跨月前一天计算正确',()=>{
  assert.equal(previousLocalDate('2026-03-01'),'2026-02-28');
});
