import { existsSync, copyFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(join(root, '.env.development.example'), envFile);
  console.log('已生成本地 .env；仅用于本机预览。');
}
const env = Object.fromEntries((await import('node:fs')).readFileSync(envFile, 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)]; }));
const url = new URL(env.DATABASE_URL);
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.port !== '54329' || url.pathname !== '/actionpoints' || env.APP_ORIGIN !== 'http://localhost:3000') {
  throw new Error('本地启动要求 .env 使用 localhost:54329 的开发数据库和 http://localhost:3000；请检查 .env。');
}
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...extraEnv } });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败：${result.error?.message || result.status}`);
}
function available(command, args = ['--version']) { const r=spawnSync(command,args,{stdio:'ignore',shell:process.platform==='win32'});return !r.error&&r.status===0; }
if (!existsSync(join(root, 'node_modules'))) run('npm',['ci']);
const binDirs = ['/opt/homebrew/opt/postgresql@17/bin','/usr/local/opt/postgresql@17/bin'];
const pgDir = binDirs.find(dir=>existsSync(join(dir,'pg_ctl')));
if (pgDir) {
  const pg = name => join(pgDir,name);
  const local = join(root,'.local');
  const data = join(local,'postgres');
  const password = decodeURIComponent(url.password);
  const pgEnv = { PGPASSWORD:password };
  mkdirSync(local,{recursive:true});
  if (!existsSync(join(data,'PG_VERSION'))) {
    const passwordFile=join(local,'init-password');
    writeFileSync(passwordFile,password+'\n',{mode:0o600});
    try { run(pg('initdb'),['-D',data,'--username=actionpoints',`--pwfile=${passwordFile}`,'--auth-host=scram-sha-256','--auth-local=scram-sha-256']); }
    finally { unlinkSync(passwordFile); }
  }
  if (!available(pg('pg_isready'),['-h','127.0.0.1','-p','54329','-U','actionpoints'])) {
    run(pg('pg_ctl'),['-D',data,'-l',join(local,'postgres.log'),'-o','-h 127.0.0.1 -p 54329','-w','start']);
  }
  const found=spawnSync(pg('psql'),['-h','127.0.0.1','-p','54329','-U','actionpoints','-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='actionpoints'"],{encoding:'utf8',env:{...process.env,...pgEnv}});
  if (found.status!==0) throw new Error(`无法连接本地数据库：${found.stderr}`);
  if (found.stdout.trim()!=='1') run(pg('createdb'),['-h','127.0.0.1','-p','54329','-U','actionpoints','actionpoints'],pgEnv);
} else if (available('docker',['compose','version'])) {
  run('docker',['compose','-f','docker-compose.dev.yml','up','-d','--wait'],env);
} else {
  throw new Error('需要 PostgreSQL 17（macOS 可运行 brew install postgresql@17）或 Docker Desktop，安装后再按 F5。');
}
run('npx',['prisma','migrate','deploy'],env);
run('npm',['run','db:seed'],env);
console.log('本地环境已就绪。VS Code 将启动网页：http://localhost:3000');
