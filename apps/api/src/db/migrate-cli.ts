import { createPool } from './database';
import { migrate } from './migrate';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createPool(url);
  try {
    const ran = await migrate(db);
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
