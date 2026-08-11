import 'dotenv/config';
import { closeDb } from './index';
import { seedDatabase } from './seed-data';

async function main(): Promise<void> {
  const summary = await seedDatabase();

  console.log('Seed complete.');
  console.log(`  users:       ${summary.users}`);
  console.log(`  categories:  ${summary.categories}`);
  console.log(`  posts:       ${summary.posts}`);
  console.log(`  menu items:  ${summary.menuItems}`);
  console.log('');
  console.log('Development-only demo accounts (passwords come from .env):');
  for (const account of summary.accounts) {
    console.log(`  ${account.role.padEnd(6)}  ${account.email}`);
  }
}

main()
  .then(() => closeDb())
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    closeDb();
    process.exit(1);
  });
