"use strict";
// Explicit opt-in integration check. Uses API credits; never prints the API key.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function main() {
  const configPath = path.resolve(__dirname, '..', '.local', 'deepseek-config.json');
  const deepseek = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const context = vm.createContext({ fetch, AbortSignal, chrome: {storage: {local: {get: async () => ({deepseek})}}} });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'edge-extension', 'deepseek.js'), 'utf8'), context);
  if(process.argv.includes('--instruction-visual')) {
    const input=JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','.local','instruction-visual.json'),'utf8'));
    const signal=AbortSignal.timeout(180000);
    const qs=await context.XXTDeepSeek.prepare(input,signal);
    if(!qs[0].stem.includes('指令')||!qs[0].stem.includes('程序'))throw new Error('Visual transcription mismatch');
    const answers=await context.XXTDeepSeek.solve(qs,signal);
    if(!['指令','程序'].every(term=>answers[0].answer[0].includes(term)))throw new Error('Answer mismatch');
    fs.writeFileSync(path.resolve(__dirname,'..','.local','instruction-live-result.json'),JSON.stringify({stem:qs[0].stem,answer:answers[0].answer[0]},null,2));
    console.log(JSON.stringify({ok:true,visualModel:'deepseek-flash',answerModel:deepseek.model,effort:(await context.XXTDeepSeek.settings()).effort,questions:1,visualTextValidated:true,answerValidated:true}));return;
  }
  const qs = [{id:'q1',type:'single',stem:'一台微型计算机的内存容量为128M，指的是：',options:[{key:'A',text:'128M位'},{key:'B',text:'128M字节'},{key:'C',text:'128M字'},{key:'D',text:'128000K字'}]},
    {id:'q2',type:'single',stem:'硬盘是计算机的什么部件？',options:[{key:'A',text:'内（主）存储器'},{key:'B',text:'CPU的一部分'},{key:'C',text:'外（辅）存储器'}]},
    {id:'q3',type:'single',stem:'显示器属于计算机的哪种设备？',options:[{key:'A',text:'输入设备'},{key:'B',text:'输出设备'},{key:'C',text:'存储设备'}]},
    {id:'q4',type:'single',stem:'一个字节由多少个二进制位组成？',options:[{key:'A',text:'4位'},{key:'B',text:'8位'},{key:'C',text:'16位'}]},
    {id:'q5',type:'single',stem:'ENIAC 于哪一年诞生？',options:[{key:'A',text:'1956'},{key:'B',text:'1945'},{key:'C',text:'1946'},{key:'D',text:'1948'}]},
    {id:'q6',type:'short',stem:'计算机的硬件系统由哪五大部分组成？',options:[]}];
  const progress=[];
  const answers = await context.XXTDeepSeek.solve(qs, AbortSignal.timeout(60000),event=>progress.push(event));
  if(answers.length!==6 || answers.slice(0,5).map(a=>a.answer.join('')).join('')!=='BCBBC' || !['运算器','控制器','存储器','输入','输出'].every(term=>answers[5].answer[0].includes(term))) throw new Error('模型答案与本地预期不符');
  console.log(JSON.stringify({ok:true,model:deepseek.model,questions:6,answers:6,batches:progress.filter(p=>p.phase==='batch').length,retries:progress.filter(p=>p.phase==='retry').length,ids:answers.map(a=>a.id),shortAnswerValidated:true}));
}
main().catch(() => { console.error('DeepSeek live check failed (no credentials logged).');process.exitCode=1; });
