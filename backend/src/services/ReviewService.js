const db = require('../db');

async function saveLocalDiff(ticketId, files) {
  if (!Array.isArray(files) || files.length === 0) return { saved: 0 };
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let saved = 0;
    for (const file of files) {
      const { path, action, old_content, new_content } = file;
      if (!path || !action) continue;
      await client.query(
        `INSERT INTO review_diffs (ticket_id, file_path, action, old_content, new_content)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ticket_id, file_path) DO UPDATE
         SET action = $3, old_content = COALESCE($4, review_diffs.old_content), new_content = COALESCE($5, review_diffs.new_content)`,
        [ticketId, path, action, old_content || null, new_content || null]
      );
      saved++;
    }
    await client.query('COMMIT');
    return { saved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getLocalDiff(ticketId) {
  const { rows } = await db.pool.query(
    'SELECT * FROM review_diffs WHERE ticket_id = $1 ORDER BY file_path',
    [ticketId]
  );
  return rows;
}

async function clearLocalDiff(ticketId) {
  await db.pool.query('DELETE FROM review_diffs WHERE ticket_id = $1', [ticketId]);
}

module.exports = { saveLocalDiff, getLocalDiff, clearLocalDiff };
