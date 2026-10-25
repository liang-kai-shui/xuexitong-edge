'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','edge-extension','text.js'),'utf8'),context);
const api=context.XXTText;
test('UEditor paragraph-free text and rendered paragraphs match a multi-line answer',()=>{
  const result=api.verify('硬件系统：\n1. 运算器。\n2. 控制器。',{editorText:'硬件系统：1. 运算器。2. 控制器。',domText:'硬件系统：\n\n1. 运算器。\n2. 控制器。',fieldFound:true,fieldText:'硬件系统：1. 运算器。2. 控制器。'});
  assert.equal(result.ok,true);
});
test('nonbreaking spaces and editor fill characters do not change answer identity',()=>{
  assert.equal(api.normalize('冯 · 诺依曼\n运算器'),api.normalize('冯\u00a0·\u200b诺依曼\ufeff运算器'));
});
test('truncated or changed body text still fails verification',()=>{
  assert.equal(api.verify('运算器、控制器、存储器。',{editorText:'运算器、控制器。',domText:'运算器、控制器。'}).ok,false);
  assert.equal(api.verify('输入设备。',{editorText:'输入设备。',domText:'输出设备。'}).code,'EDITOR_DOM_MISMATCH');
});
test('a visible answer with an empty or stale submission field is not accepted',()=>{
  for(const fieldText of ['', '旧答案'])assert.equal(api.verify('新答案',{editorText:'新答案',domText:'新答案',fieldFound:true,fieldText}).code,'SYNC_FIELD_MISMATCH');
});
test('digits, punctuation and answer text remain exact',()=>{
  assert.notEqual(api.normalize('128M字节'),api.normalize('128M位'));
  assert.notEqual(api.normalize('1+2=3'),api.normalize('1-2=3'));
  assert.notEqual(api.normalize('1946'),api.normalize('1945'));
});
test('editor diagnostics contain lengths and state only, not answer text',()=>{
  const result=api.verify('不应出现在诊断中的答案',{editorText:'错误',domText:'错误',fieldFound:false});
  assert.equal(JSON.stringify(result).includes('诊断中的答案'),false);
  assert.equal(result.diagnostic.fieldFound,false);
});
