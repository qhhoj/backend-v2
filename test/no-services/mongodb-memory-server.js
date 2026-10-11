/** mongodb-memory-server for unit specs: starting a server throws (startMongo() lands here without the DB global setup). */
const message = require('./message');

const refuse = () => {
  throw new Error(message('Starting MongoDB'));
};
module.exports = {
  MongoMemoryServer: { create: refuse },
  MongoMemoryReplSet: { create: refuse },
};
