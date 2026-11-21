import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HOME_PERSONALIZATION, HOME_SHORTCUTS, type HomeHistoryEntry } from "@peebee/shared";
import { EMPTY_HOME_PREFERENCES, homeClock, homeGreeting, homeSuggestions, parseHomePreferences } from "./personalized-home";
const date = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0);
const all = [...HOME_SHORTCUTS];
const make = (now = date(23, 7), history: HomeHistoryEntry[] = []) => ({ now, history, available: all, enrollments: [], preferences: { ...EMPTY_HOME_PREFERENCES }, rules: { ...DEFAULT_HOME_PERSONALIZATION } });
test("local clock handles midnight/noon, correct weekday and ordinal dates", () => {
  assert.equal(homeClock(date(21, 21)).time, "Saturday, 9:00pm");
  assert.equal(homeClock(date(21, 0)).time, "Saturday, 12:00am");
  assert.equal(homeClock(date(21, 12)).time, "Saturday, 12:00pm");
  for (const [day, suffix] of [[1,"1st"],[2,"2nd"],[3,"3rd"],[11,"11th"],[12,"12th"],[13,"13th"],[21,"21st"],[22,"22nd"],[23,"23rd"],[30,"30th"]] as const) assert.equal(homeClock(date(day, 12)).date, `November ${suffix}`);
});
test("greetings follow admin boundaries, including pre-dawn night", () => {
  const r = DEFAULT_HOME_PERSONALIZATION;
  assert.equal(homeGreeting(date(21,4),r),"Still up");
  assert.equal(homeGreeting(date(21,5),r),"Good morning");
  assert.equal(homeGreeting(date(21,12),r),"Good afternoon");
  assert.equal(homeGreeting(date(21,17),r),"Good evening");
  assert.equal(homeGreeting(date(21,22),r),"Still up");
  assert.equal(homeGreeting(date(21,17),{...r,eveningHour:18}),"Good afternoon");
});
test("new customers get honest time-based suggestions without invented favourites or church", () => {
  assert.equal(homeSuggestions(make())[0].id,"boda");
  assert.equal(homeSuggestions(make(date(23,13)))[0].id,"restaurants");
  assert.equal(homeSuggestions(make(date(21,8)))[0].id,"clean");
  assert.equal(homeSuggestions(make(date(24,19)))[0].id,"streetfood");
  assert.equal(homeSuggestions(make(date(24,23)))[0].id,"learn");
  assert.ok(homeSuggestions(make(date(22,8))).every(s=>!s.detail.includes("Church")&&!s.title.includes("office")));
});
test("routines need repeated completed activity at the right day/time, and respect history opt-out", () => {
  const history: HomeHistoryEntry[] = [16,17].map((day,i)=>({id:String(i),createdAt:date(day,7).toISOString(),kind:"ride",destination:"Office area",restaurantId:null,restaurantName:null}));
  const input=make(date(23,7),history);
  assert.equal(homeSuggestions(input)[0].id,"routine:Office area");
  assert.notEqual(homeSuggestions({...input,history:history.slice(0,1)})[0].id,"routine:Office area");
  assert.ok(homeSuggestions({...input,now:date(22,7)}).every(s=>!s.id.startsWith("routine:")));
  assert.ok(homeSuggestions({...input,preferences:{...input.preferences,enabled:false}}).every(s=>!s.id.startsWith("routine:")));
  assert.ok(homeSuggestions({...input,rules:{...input.rules,historyEnabled:false}}).every(s=>!s.id.startsWith("routine:")));
});
test("module eligibility, dismissed suggestions and chosen interests affect recommendations", () => {
  const input=make();
  assert.ok(homeSuggestions({...input,available:all.filter(s=>!s.module.startsWith("ride"))}).every(s=>s.interest!=="ride"));
  assert.notEqual(homeSuggestions({...input,preferences:{...input.preferences,hidden:["boda"]}})[0].id,"boda");
  assert.equal(homeSuggestions({...input,preferences:{...input.preferences,interests:["buy"]}})[0].interest,"buy");
  assert.ok(homeSuggestions({...input,rules:{...input.rules,foodSuggestions:false}}).every(s=>s.interest!=="eat"));
  assert.deepEqual(parseHomePreferences('{"interests":["buy","invalid"],"hidden":[1,"boda"]}'),{enabled:true,interests:["buy"],hidden:["boda"]});
  assert.deepEqual(parseHomePreferences("bad json"),EMPTY_HOME_PREFERENCES);
});
