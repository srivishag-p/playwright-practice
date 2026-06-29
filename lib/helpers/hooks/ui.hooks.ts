import {
  Before,
  After,
  BeforeAll,
  AfterAll,
  BeforeStep,
  Status,
  ITestCaseHookParameter,
  ITestStepHookParameter,
} from '@cucumber/cucumber';
import { CustomWorld } from '../world/CustomWorld';
import { FailureContext, FailureIntelligenceEngine } from '@helpers/ai-failure';
import { logger } from '@utils/logger';

BeforeAll(async function () {
  logger.info('UI BDD suite starting');
});

AfterAll(async function () {
  logger.info('UI BDD suite complete');
});

Before({ tags: '@ui' }, async function (this: CustomWorld, { pickle }: ITestCaseHookParameter) {
  this.scenarioName = pickle.name;
  await this.initBrowser();
});

// Record the current step text so the Failure Intelligence Engine can report
// exactly which step failed.
BeforeStep({ tags: '@ui' }, function (this: CustomWorld, { pickleStep }: ITestStepHookParameter) {
  if (this.page) {
    FailureContext.for(this.page).setCurrentStep(pickleStep.text);
  }
});

After({ tags: '@ui' }, async function (this: CustomWorld, { result }: ITestCaseHookParameter) {
  if (result?.status === Status.FAILED) {
    logger.error(`Scenario FAILED: ${this.scenarioName}`);
    // Build the Failure Intelligence Package and publish the enhanced Allure
    // report. The engine swallows its own errors so teardown always runs.
    if (this.page) {
      await FailureIntelligenceEngine.run(this, result.message ?? '');
    }
  }
  await this.closeBrowser();
});
