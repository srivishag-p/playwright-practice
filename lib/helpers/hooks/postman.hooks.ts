import { Before, After, Status, ITestCaseHookParameter } from '@cucumber/cucumber';
import { CustomWorld } from '../world/CustomWorld';
import { PostmanHandler } from '@components/postman/postman_handler';
import { CartDbValidator } from '@db/validators/CartDbValidator';
import { logger } from '@utils/logger';

// Runs before every @postman scenario.
// Initialises PostmanHandler + DB client (needed for API → DB assertion chain).
Before({ tags: '@postman' }, async function (this: CustomWorld, { pickle }: ITestCaseHookParameter) {
  this.scenarioName = pickle.name;
  this.postmanHandler = new PostmanHandler();

  // Connect DB so that cart.db.steps can run assertions in the same scenario
  await this.initDbClient();
  this.cartDbValidator = new CartDbValidator(this.dbClient);

  // Attempt cart cleanup for test isolation — skip silently if DB user lacks DELETE permission
  const schema = process.env.DB_SCHEMA ?? 'order_service';
  const custId = process.env.TEST_CUSTOMER_ID ?? '151';
  try {
    await this.dbClient.execute(`DELETE FROM ${schema}.cart WHERE customer_id = $1`, [custId]);
    logger.debug(`Cart cleared for customer ${custId}`);
  } catch {
    logger.debug(`Cart cleanup skipped — DB user has no DELETE permission (read-only assertions only)`);
  }

  logger.info(`[@postman] Starting: "${this.scenarioName}"`);
});

After({ tags: '@postman' }, async function (this: CustomWorld, { result }: ITestCaseHookParameter) {
  if (result?.status === Status.FAILED) {
    const body = this.postmanHandler?.getResponseBody();
    if (body) {
      await this.attach(JSON.stringify(body, null, 2), 'application/json');
    }
    logger.error(`[@postman] FAILED: "${this.scenarioName}"`);
  }
  await this.closeDbClient();
  logger.info(`[@postman] Finished: "${this.scenarioName}"`);
});
