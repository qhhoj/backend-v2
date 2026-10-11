/** ioredis for unit specs: importing works (barrels reach RedisModule), constructing a client throws instead of retrying forever. */
const real = require('ioredis/built/index.js');
const message = require('./message');

// Extends the real class, so the module's other exports (Cluster, Command, ...) are inherited statics.
class Redis extends real.Redis {
  constructor() {
    throw new Error(message('new Redis()'));
  }
}
for (const name of ['default', 'Redis'])
  Object.defineProperty(Redis, name, { value: Redis });
Object.defineProperty(Redis, '__esModule', { value: true });
module.exports = Redis;
