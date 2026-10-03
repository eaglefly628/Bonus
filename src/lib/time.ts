export const zone = process.env.APP_TIMEZONE || 'Asia/Shanghai';
export function localDate(date = new Date(), timeZone = zone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function localHourMinute(date = new Date(), timeZone = zone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
export function localWeekday(date = new Date(), timeZone = zone) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(short);
}
export function previousLocalDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0,10);
}
export function scheduledInstant(date: string, time: string, timeZone = zone) {
  const [h,m] = time.split(':').map(Number);
  if (!/^\d{2}:\d{2}$/.test(time) || h > 23 || m > 59) return null;
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const shown = Date.UTC(get('year'), get('month')-1, get('day'), get('hour'), get('minute'));
    guess += target - shown;
  }
  return new Date(guess);
}
