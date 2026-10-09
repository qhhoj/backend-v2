// node init-replset.js <port>: makes the single mongod a one-member replica set (transactions need it). Safe to repeat.
const mongoose = require('mongoose');

const port = process.argv[2];
const ALREADY_INITIALIZED = 23;

async function main() {
  const connection = await mongoose
    .createConnection(`mongodb://127.0.0.1:${port}/?directConnection=true`)
    .asPromise();
  try {
    await connection.db.admin().command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
    });
  } catch (error) {
    if (error.code !== ALREADY_INITIALIZED) throw error;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const hello = await connection.db.admin().command({ hello: 1 });
    if (hello.isWritablePrimary) return connection.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('replica set never elected a primary');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
