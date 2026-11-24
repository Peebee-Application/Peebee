import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('push worker isolates accounts, closes old notifications and never caches or follows payload URLs',async()=>{
 const handlers={},notifications=[],opened=[],messages=[];let account=null;
 const indexedDB={open(){const r={result:{createObjectStore(){},transaction(){return {objectStore(){return {get(){const q={result:account};queueMicrotask(()=>q.onsuccess?.());return q;},put(value){account=value;const q={result:value};queueMicrotask(()=>q.onsuccess?.());return q;}};}};}}};queueMicrotask(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
 const self={location:{origin:'https://taxibee.peebee.online'},skipWaiting(){},addEventListener(k,fn){handlers[k]=fn;},registration:{async getNotifications(){return [{close(){messages.push('closed');}}];},async showNotification(title,options){notifications.push({title,options});}},clients:{async claim(){},async matchAll(){return [];},async openWindow(url){opened.push(url);}}};
 vm.runInNewContext(readFileSync(new URL('../public/push-sw.js',import.meta.url),'utf8'),{self,indexedDB,queueMicrotask,URL});
 const event=async(type,data)=>{let work;handlers[type]({...data,waitUntil(p){work=p;}});await work;};
 assert.equal(handlers.fetch,undefined,'No fetch handler means no cached account/API data');
 await event('message',{data:{type:'account-binding',accountId:'a'}});await event('push',{data:{json:()=>({accountId:'a',title:'Trip',body:'Private',url:'https://evil.test'})}});assert.equal(notifications.length,1);
 await event('message',{data:{type:'account-binding',accountId:'b'}});await event('message',{data:{type:'account-unbind',accountId:'a'}});assert.equal(account,'b','Signing out an older tab must not unbind another account');
 await event('push',{data:{json:()=>({accountId:'a',title:'Old private message'})}});assert.equal(notifications.length,1);
 await event('notificationclick',{notification:{data:{accountId:'b'},close(){}}});assert.deepEqual(opened,['/?screen=notifications'],'Notification payloads cannot redirect outside Taxibee');
 await event('message',{data:{type:'account-unbind',accountId:'b'}});await event('push',{data:{json:()=>({accountId:'b',title:'Signed-out private message'})}});assert.equal(notifications.length,1);assert.ok(messages.length>=3);
});
