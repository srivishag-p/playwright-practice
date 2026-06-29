import { Before, After, Status, ITestCaseHookParameter } from '@cucumber/cucumber';
import { CustomWorld } from '../world/CustomWorld';
import { logger } from '@utils/logger';

Before({ tags: '@db' }, async function (this: CustomWorld, { pickle }: ITestCaseHookParameter) {
  this.scenarioName = pickle.name;
  await this.initDbClient();
});

After({ tags: '@db' }, async function (this: CustomWorld, { result }: ITestCaseHookParameter) {
  if (result?.status === Status.FAILED) {
    logger.error(`DB scenario FAILED: ${this.scenarioName}`);
  }
  await this.closeDbClient();
});
