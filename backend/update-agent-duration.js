require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('callcenter');
  const col = db.collection('calls');

  const docs = await col.find({
    agent_answer_time: { $exists: true, $ne: '', $ne: null },
    call_end_time:     { $exists: true, $ne: '', $ne: null },
  }).toArray();

  let updated = 0, skipped = 0, negative = 0;

  for (const doc of docs) {
    const diff = Math.floor((new Date(doc.call_end_time) - new Date(doc.agent_answer_time)) / 1000);
    if (diff <= 0) { negative++; continue; }
    await col.updateOne({ _id: doc._id }, { $set: { agent_duration: diff } });
    updated++;
  }

  const nulled = await col.updateMany(
    { $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }, { agent_answer_time: null }] },
    { $unset: { agent_duration: '' } }
  );

  console.log(`Updated:  ${updated}`);
  console.log(`Negative/skipped: ${negative}`);
  console.log(`Cleared agent_duration on missed calls: ${nulled.modifiedCount}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
