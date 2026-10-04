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
      {name:'出门',icon:'🎒',steps:['检查要带的东西','穿好鞋','准备出门']}
    ];
    for(let i=0;i<patterns.length;i++){
      const p=patterns[i];
      await db.action.create({data:{name:p.name,icon:p.icon,description:'示例步骤和分值，请在管理 → Pattern 中按你们家的习惯修改。',firstStep:p.steps[0],points:p.steps.length,sortOrder:i,steps:{create:p.steps.map((text,sortOrder)=>({text,points:1,sortOrder}))}}});
    }
  }
  // Retire only the original demo Pattern. Keep its record and any earned points.
  if(!await db.setting.findUnique({where:{key:'demoHomeworkRetired'}})){
    const homework=await db.action.findMany({where:{name:'做作业',createdBy:null,description:'示例步骤和分值，请在管理 → Pattern 中按你们家的习惯修改。'},include:{steps:{orderBy:{sortOrder:'asc'}}}});
    for(const action of homework){
      if(action.steps.map(step=>step.text).join('|')==='坐到书桌前|拿出作业|开始做作业|检查并收好') await db.action.update({where:{id:action.id},data:{enabled:false}});
    }
    await db.setting.create({data:{key:'demoHomeworkRetired',value:'true'}});
  }
  if(process.env.NODE_ENV!=='production' && process.env.DEV_MEMBER_PASSWORD && process.env.APP_ORIGIN==='http://localhost:3000' && !await db.setting.findUnique({where:{key:'localDemoRewardSeeded'}})){
    if(await db.reward.count({where:{enabled:true}})===0) await db.reward.createMany({data:[
      {name:'演示 · 体验兑换券',icon:'🎟️',description:'用于练习兑换与使用流程；不代表家庭正式奖励。',cost:2,repeatable:true,sortOrder:0},
      {name:'演示 · 选一部家庭电影',icon:'🎬',description:'示例：周末选一部适合全家看的电影，具体时段由家人商量。',cost:8,repeatable:true,sortOrder:1},
      {name:'演示 · 选一次晚餐',icon:'🍽️',description:'示例：在家人认可的选项中，决定一次晚餐菜单。',cost:12,repeatable:true,sortOrder:2},
      {name:'演示 · 周末活动提案',icon:'🌿',description:'示例：提出一次周末活动，由家人一起确认时间和安排。',cost:20,repeatable:true,sortOrder:3}
    ]});
    await db.setting.create({data:{key:'localDemoRewardSeeded',value:'true'}});
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
