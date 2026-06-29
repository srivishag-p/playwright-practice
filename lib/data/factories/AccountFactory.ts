import { faker } from '@faker-js/faker';
import type { AccountData } from '@pages/bc/AccountCreationPage';

export class AccountFactory {
  static build(overrides: Partial<AccountData> = {}): AccountData {
    return {
      firstName: faker.person.firstName(),
      lastName:  faker.person.lastName(),
      company:   faker.company.name(),
      street:    faker.location.streetAddress(),
      city:      faker.location.city(),
      state:     faker.location.state(),
      zip:       faker.location.zipCode('#####'),
      email:     faker.internet.email().toLowerCase(),
      phone:     faker.string.numeric(10),
      ...overrides,
    };
  }

  static buildList(count: number, overrides: Partial<AccountData> = {}): AccountData[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }
}
