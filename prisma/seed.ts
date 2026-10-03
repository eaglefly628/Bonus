import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db=new PrismaClient();
async function main(){
  const count=await db.user.count({where:{role:'ADMIN'}});
  if(!count){
    const username=process.env.INITIAL_ADMIN_USERNAME||'admin', password=process.env.INITIAL_ADMIN_PASSWORD||'';
    if(password.length<12) throw new Error('首次启动必须设置 INITIAL_ADMIN_PASSWORD，至少 12 位');
    await db.user.create({data:{username,passwordHash:await bcrypt.hash(password,12),role:'ADMIN'}});
    console.log(`已创建管理员 ${username}`);
  }
  const defaults=[
    ['吃饭','🍽️','走到餐桌前',1,'12:00'],
    ['开始学习','📚','坐到书桌前',3,'19:00'],
    ['学习20分钟','⏱️','打开计时器',2,'19:20'],
    ['洗澡','🚿','准备换洗衣物',1,'20:30'],
    ['睡前准备','🌙','放下手机',3,'21:30']
  ] as const;
  const initialActions=await db.action.count()===0;
  if(initialActions) for(let i=0;i<defaults.length;i++){const [name,icon,firstStep,points,scheduledTime]=defaults[i];await db.action.create({data:{name,icon,firstStep,points,scheduledTime,sortOrder:i}});}
  const bonuses=[['主动开始',2],['自己设 Timer',1],['自己安排任务',2],['发现拖延后重新开始',2],['休息后准时回来',2]] as const;
  if(await db.bonusRule.count()===0) for(let i=0;i<bonuses.length;i++)await db.bonusRule.create({data:{name:bonuses[i][0],points:bonuses[i][1],sortOrder:i}});
  if(await db.reward.count()===0){await db.reward.createMany({data:[{name:'周末电影时间',icon:'🎬',description:'挑一部喜欢的电影',cost:20,sortOrder:0},{name:'选择一次晚餐',icon:'🍜',description:'由你决定一顿晚餐',cost:30,sortOrder:1},{name:'特别活动',icon:'✨',description:'一起安排一次特别的活动',cost:50,sortOrder:2}]});}
  if(process.env.NODE_ENV!=='production' && process.env.DEV_MEMBER_PASSWORD && !(await db.user.findUnique({where:{username:'member'}}))) await db.user.create({data:{username:'member',passwordHash:await bcrypt.hash(process.env.DEV_MEMBER_PASSWORD,12),role:'MEMBER'}});
  const users=await db.user.findMany({where:{role:'MEMBER'}}), actions=await db.action.findMany();
  if(initialActions) for(const u of users)for(const a of actions)await db.actionAssignment.upsert({where:{actionId_userId:{actionId:a.id,userId:u.id}},create:{actionId:a.id,userId:u.id},update:{}});
  for(const [key,value] of [['settlementTime','22:30'],['dailyBonusThreshold','0'],['dailyBonusPoints','0']])await db.setting.upsert({where:{key},create:{key,value},update:{}});
}
main().finally(()=>db.$disconnect());
