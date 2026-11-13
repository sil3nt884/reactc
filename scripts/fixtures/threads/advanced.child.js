// A fork with serialization: 'advanced' gets Maps and BigInts intact.
process.once('message', value => {
  process.send({ isMap: value instanceof Map, total: value.get('a') + value.get('b') });
  process.disconnect();
});
