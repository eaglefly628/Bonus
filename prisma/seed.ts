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
  const oldNames=['吃饭','开始学习','学习20分钟','洗澡','睡前准备'];
  const existing=await db.action.findMany({include:{steps:true}});
  const initialActions=existing.length===0;
  const oldDemo=existing.length===oldNames.length && oldNames.every(name=>existing.some(a=>a.name===name)) && existing.every(a=>a.steps.length===0);
  if(oldDemo) await db.action.updateMany({data:{enabled:false}});
  if(initialActions||oldDemo){
    const patterns=[
      {name:'吃饭',icon:'🍽️',steps:['到餐桌前','开始吃饭','收好餐具']},
      {name:'戴眼镜',icon:'👓',steps:['找到眼镜','戴好眼镜']},
      {name:'刷牙',icon:'🪥',steps:['拿好牙刷','刷牙','漱口并放好牙刷']},
      {name:'洗澡',icon:'🚿',steps:['准备换洗衣物','去洗澡','收好衣物']},
      {name:'做作业',icon:'📚',steps:['坐到书桌前','拿出作业','开始做作业','检查并收好']},
      {name:'出门',icon:'🎒',steps:['检查要带的东西','穿好鞋','准备出门']}
    ];
    for(let i=0;i<patterns.length;i++){
      const p=patterns[i];
      await db.action.create({data:{name:p.name,icon:p.icon,description:'示例步骤和分值，请在管理 → Pattern 中按你们家的习惯修改。',firstStep:p.steps[0],points:p.steps.length,sortOrder:i,steps:{create:p.steps.map((text,sortOrder)=>({text,points:1,sortOrder}))}}});
    }
  }
  const bonuses=[['主动开始',2],['自己设 Timer',1],['自己安排任务',2],['发现拖延后重新开始',2],['休息后准时回来',2]] as const;
  if(await db.bonusRule.count()===0) for(let i=0;i<bonuses.length;i++)await db.bonusRule.create({data:{name:bonuses[i][0],points:bonuses[i][1],sortOrder:i}});
  const demoRewards=await db.reward.findMany();
  if(!await db.setting.findUnique({where:{key:'demoRewardsRetired'}}) && demoRewards.length===3 && [['周末电影时间',20],['选择一次晚餐',30],['特别活动',50]].every(([name,cost])=>demoRewards.some(r=>r.name===name&&r.cost===cost)) && await db.rewardRedemption.count()===0){
    await db.reward.updateMany({data:{enabled:false}});
    await db.setting.create({data:{key:'demoRewardsRetired',value:'true'}});
  }
  if(process.env.NODE_ENV!=='production' && process.env.DEV_MEMBER_PASSWORD && !(await db.user.findUnique({where:{username:'member'}}))) await db.user.create({data:{username:'member',passwordHash:await bcrypt.hash(process.env.DEV_MEMBER_PASSWORD,12),role:'MEMBER'}});
  const users=await db.user.findMany({where:{role:'MEMBER'}}), actions=await db.action.findMany({where:{enabled:true}});
  if(initialActions||oldDemo) for(const u of users)for(const a of actions)await db.actionAssignment.upsert({where:{actionId_userId:{actionId:a.id,userId:u.id}},create:{actionId:a.id,userId:u.id},update:{}});
  for(const [key,value] of [['settlementTime','22:30'],['dailyBonusThreshold','0'],['dailyBonusPoints','0']])await db.setting.upsert({where:{key},create:{key,value},update:{}});
}
main().finally(()=>db.$disconnect());
