import 'dotenv/config';
import { closeDb } from '@/server/db';
import { publishDuePosts } from '@/server/services/schedule-service';

/**
 * CLI entry point for scheduled publishing.
 *
 * Idempotent: running it twice publishes nothing the second time. Intended for
 * cron or the Docker host scheduler; the same logic is also exposed at
 * POST /api/v1/internal/jobs/publish-scheduled behind SCHEDULE_JOB_SECRET.
 */

function main(): void {
  const startedAt = Date.now();
  const result = publishDuePosts(new Date(), `cli-${startedAt}`);

  console.log('Scheduled publishing run');
  console.log(`  due posts:  ${result.checked}`);
  console.log(`  published:  ${result.published}`);
  console.log(`  skipped:    ${result.skipped}`);
  console.log(`  failed:     ${result.failed}`);
  console.log(`  duration:   ${Date.now() - startedAt}ms`);

  closeDb();

  if (result.failed > 0) process.exit(1);
}

main();
