import * as allure from 'allure-js-commons';

export type Severity = 'blocker' | 'critical' | 'normal' | 'minor' | 'trivial';

export async function setAllureLabels(options: {
  feature?: string;
  story?: string;
  severity?: Severity;
  owner?: string;
  tag?: string;
  suite?: string;
}): Promise<void> {
  if (options.feature)  await allure.label('feature', options.feature);
  if (options.story)    await allure.label('story', options.story);
  if (options.severity) await allure.label('severity', options.severity);
  if (options.owner)    await allure.label('owner', options.owner);
  if (options.tag)      await allure.tag(options.tag);
  if (options.suite)    await allure.label('suite', options.suite);
}

export async function attachJson(name: string, data: unknown): Promise<void> {
  await allure.attachment(name, JSON.stringify(data, null, 2), {
    contentType: 'application/json',
  });
}

export async function attachText(name: string, text: string): Promise<void> {
  await allure.attachment(name, text, { contentType: 'text/plain' });
}

export async function attachScreenshot(name: string, buffer: Buffer): Promise<void> {
  await allure.attachment(name, buffer, { contentType: 'image/png' });
}

export async function addParameter(name: string, value: string): Promise<void> {
  await allure.parameter(name, value);
}
