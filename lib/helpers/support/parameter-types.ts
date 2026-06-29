import { defineParameterType } from '@cucumber/cucumber';

// Custom parameter type for role-based users
defineParameterType({
  name: 'role',
  regexp: /admin|user|manager|viewer/,
  transformer: (role: string) => role,
});

// Custom parameter type for HTTP methods
defineParameterType({
  name: 'httpMethod',
  regexp: /GET|POST|PUT|PATCH|DELETE/,
  transformer: (method: string) => method,
});
