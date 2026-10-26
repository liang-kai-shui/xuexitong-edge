'use strict';
// Windows Edge launcher using the user's existing profiles. No password input.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {createInterface}=require('node:readline/promises');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'edge-extension');
function json(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function profiles(dataRoot){
  const info=json(path.join(dataRoot,'Local State')).profile?.info_cache || {};
  const names=Object.keys(info).filter(name=>/^(?:Default|Profile \d+)$/.test(name) && fs.existsSync(path.join(dataRoot,name)));
  if(!names.length && fs.existsSync(path.join(dataRoot,'Default')))names.push('Default');
  return names.map(directory=>({directory,name:String(info[directory]?.name || directory).replace(/[\r\n]/g,' ').slice(0,60)}));
}
function findExtensionId(dataRoot,directory){
  if(!/^(?:Default|Profile \d+)$/.test(directory))throw new Error('无效的 Edge 配置文件目录');
  const hits=[],expected=json(path.join(extension,'manifest.json'));
  if(!expected.version)throw new Error('本项目扩展清单缺失，请完整解压安装包');
  for(const name of ['Preferences','Secure Preferences']){
    const settings=json(path.join(dataRoot,directory,name)).extensions?.settings || {};
    for(const [id,entry] of Object.entries(settings)){
      if(entry.state===0 || !/^[a-p]{32}$/.test(id) || typeof entry.path!=='string')continue;
      const location=path.isAbsolute(entry.path)?entry.path:path.resolve(dataRoot,directory,entry.path);
      if(!fs.existsSync(path.join(location,'launcher.html')))continue;
      const manifest=json(path.join(location,'manifest.json'));
      if(manifest.version!==expected.version || manifest.name!==expected.name || manifest.manifest_version!==3)continue;
      if(entry.manifest?.version && entry.manifest.version!==manifest.version)continue;
      if(path.resolve(location).toLowerCase()===path.resolve(extension).toLowerCase())return id;
      if(manifest.name==='学习通视频播放助手' && manifest.manifest_version===3)hits.push(id);
    }
  }
  return [...new Set(hits)].length===1?hits[0]:null;
}
function args(argv){
  const options={};for(let i=0;i<argv.length;i++){
    const flag=argv[i];if(['--dry-run','--help','--list-profiles'].includes(flag)){options[flag.slice(2)]=true;continue;}
    if(!['--profile-directory','--course-id','--user-data-root','--edge'].includes(flag) || !argv[i+1])throw new Error('参数无效。运行 --help 查看用法；脚本不接收账号密码。');
    options[flag.slice(2)]=argv[++i];
  }
  if(options['course-id'] && !/^[1-9]\d{0,19}$/.test(options['course-id']))throw new Error('课程编号需为数字');
  return options;
}
function edgePath(explicit){
  const candidates=[explicit,path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),path.join(process.env.ProgramFiles || 'C:\\Program Files','Microsoft','Edge','Application','msedge.exe')].filter(Boolean);
  const found=candidates.find(p=>fs.existsSync(p));if(!found)throw new Error('未找到 Microsoft Edge；可用 --edge 指定 msedge.exe 路径');return found;
}
async function openEdge(exe,argv){
  const child=spawn(exe,argv,{detached:true,stdio:'ignore',windowsHide:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
async function main(argv=process.argv.slice(2)){
  const options=args(argv);
  if(options.help){console.log('双击“启动学习.cmd”即可。首次按提示选择 Edge 配置文件。\n可选：--profile-directory "Profile 1" --course-id 212800861\n--list-profiles 列出配置文件；--dry-run 仅检查，不打开浏览器、不写设置。\n登录在 Edge 页面完成，脚本不接收或保存账号密码。');return;}
  const dataRoot=options['user-data-root']?path.resolve(options['user-data-root']): path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'Microsoft','Edge','User Data');
  const available=profiles(dataRoot);if(!available.length)throw new Error('没有发现 Edge 配置文件。请先打开 Edge，创建独立配置文件并加载扩展。');
  if(options['list-profiles']){available.forEach((p,i)=>console.log(`${i+1}. ${p.name} [${p.directory}]`));return;}
  const configPath=path.join(root,'.local','launch-profile.json'),last=json(configPath);
  let directory=options['profile-directory'] || last.profileDirectory;
  if(!available.some(p=>p.directory===directory))directory=undefined;
  if(options['profile-directory'] && !directory)throw new Error('指定的 Edge 配置文件不存在；先用 --list-profiles 查看');
  if(!directory){
    if(available.length===1)directory=available[0].directory;
    else if(options['dry-run'])throw new Error('检测到多个配置文件；dry-run 需指定 --profile-directory');
    else {
      available.forEach((p,i)=>console.log(`${i+1}. ${p.name} [${p.directory}]`));
      const rl=createInterface({input:process.stdin,output:process.stdout});
      try{const answer=await rl.question('选择本次账号对应的 Edge 配置文件编号：');directory=available[Number(answer)-1]?.directory;}finally{rl.close();}
      if(!directory)throw new Error('未选择有效配置文件');
    }
  }
  const exe=edgePath(options.edge),id=findExtensionId(dataRoot,directory);
  const browserArgs=['--profile-directory='+directory,...(options['user-data-root']?['--user-data-dir='+dataRoot]:[]),'--new-window'];
  if(!id){
    const message='此配置文件没有加载本项目当前版本的启动扩展。\n保留设置的更新方法：把新版 edge-extension 中的文件覆盖到现有扩展详情所示的加载目录，再点击重新加载。\n首次使用则开启开发人员模式并加载：\n'+extension+'\n完成后关闭旧启动页，重新运行启动脚本。';
    if(!options['dry-run']){console.log(message);await openEdge(exe,[...browserArgs,'edge://extensions/']);}
    throw new Error(options['dry-run']?'未发现此配置文件中的启动扩展':message);
  }
  const url=new URL('chrome-extension://'+id+'/launcher.html');url.searchParams.set('autorun','1');if(options['course-id'])url.searchParams.set('courseId',options['course-id']);
  const plan={profileDirectory:directory,extensionId:id,url:url.href};
  if(options['dry-run']){console.log(JSON.stringify(plan,null,2));return plan;}
  fs.mkdirSync(path.dirname(configPath),{recursive:true});fs.writeFileSync(configPath,JSON.stringify({profileDirectory:directory},null,2));
  await openEdge(exe,[...browserArgs,url.href]);
  console.log('已打开独立配置文件 '+directory+'。请在 Edge 窗口扫码／手动登录；后续导航由启动面板显示。');return plan;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={profiles,findExtensionId,args,main};
