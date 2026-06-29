@db @users-db
Feature: Users Database Validation
  As a QA engineer
  I want to verify data integrity in the database
  So that API and UI data matches the underlying data store

  @smoke
  Scenario: Users table exists and contains records
    When I query "SELECT COUNT(*) as count FROM users"
    Then the result count should be greater than 0

  @smoke
  Scenario: Verify user record by email
    When I query "SELECT * FROM users WHERE email = 'admin@osyte.com'"
    Then the result should contain field "email" with value "admin@osyte.com"

  @positive
  Scenario: Verify user role is set correctly
    When I query "SELECT role FROM users WHERE email = 'admin@osyte.com'"
    Then the result should contain field "role" with value "admin"
