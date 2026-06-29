import { Before, After, Status, ITestCaseHookParameter } from '@cucumber/cucumber';
import { CustomWorld } from '../world/CustomWorld';
import { logger } from '@utils/logger';

Before({ tags: '@api' }, async function (this: CustomWorld, { pickle }: ITestCaseHookParameter) {
  this.scenarioName = pickle.name;
  await this.initApiContext();
});

After({ tags: '@api' }, async function (this: CustomWorld, { result }: ITestCaseHookParameter) {
  if (result?.status === Status.FAILED && this.lastApiResponse) {
    const dump = JSON.stringify(this.lastApiResponse, null, 2);
    await this.attach(dump, 'application/json');
    logger.error(`API scenario FAILED: ${this.scenarioName}`);
  }
  await this.closeApiContext();
});
