const assert = require('assert');
const { isDue, normalizeTask, waterMinutesLeft } = require('../src/scheduler');

// 2026-10-15 is a Thursday
const at = (h, m, s = 0) => new Date(2026, 9, 15, h, m, s);
const daily = { id: 'a', time: '10:00', text: 'x' };

assert.ok(isDue(daily, at(10, 0), {}), 'fires at the exact minute');
assert.ok(!isDue(daily, at(9, 59, 59), {}), 'not before its time');
assert.ok(isDue(daily, at(10, 9), {}), 'catch-up within 10 min');
assert.ok(!isDue(daily, at(10, 11), {}), 'too late after the catch-up window');
assert.ok(!isDue(daily, at(10, 0), { 'a|2026-10-15': true }), 'not twice a day');
assert.ok(!isDue({ ...daily, done: true }, at(10, 0), {}), 'done tasks never fire');

assert.ok(isDue({ ...daily, days: ['Thu'] }, at(10, 0), {}), 'matching weekday');
assert.ok(!isDue({ ...daily, days: ['Mon', 'Tue'] }, at(10, 0), {}), 'other weekday');
assert.ok(isDue({ ...daily, date: '2026-10-15' }, at(10, 0), {}), 'one-off today');
assert.ok(!isDue({ ...daily, date: '2026-10-16' }, at(10, 0), {}), 'one-off tomorrow');
assert.ok(!isDue({ ...daily, time: 'bad' }, at(10, 0), {}), 'bad time ignored');

assert.strictEqual(normalizeTask({ text: '  ', time: '10:00' }, 'i'), null, 'empty text rejected');
assert.strictEqual(normalizeTask({ text: 'a', time: '10am' }, 'i'), null, 'bad time rejected');
const t = normalizeTask({ text: 'Call', time: '09:30', days: ['Mon', 'Foo'], date: '2026-10-15', characterId: 'bolt' }, 'id1');
assert.deepStrictEqual(t, { id: 'id1', text: 'Call', time: '09:30', done: false, days: ['Mon'], date: '2026-10-15', characterId: 'bolt' });
assert.strictEqual(normalizeTask({ text: 'a', time: '09:30', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }, 'i').days, undefined, 'all 7 days = daily');

assert.strictEqual(waterMinutesLeft(0, 0, 1000), null);
assert.strictEqual(waterMinutesLeft(0, 45, 44 * 60000), 1);
assert.strictEqual(waterMinutesLeft(0, 45, 99 * 60000), 0);

console.log('scheduler tests passed');
