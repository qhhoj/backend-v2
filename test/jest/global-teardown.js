/** Stops the replica set `global-setup.js` started. */
module.exports = async () => {
  await globalThis.__QHHOJ_TEST_MONGO__?.stop();
};
