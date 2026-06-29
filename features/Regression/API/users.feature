@api @users
Feature: Users API
  As an API consumer
  I want to manage users via the REST API
  So that user data is accurate and up to date

  @smoke @positive
  Scenario: Get all users returns 200
    When I send a GET request to "/users"
    Then the response status should be 200
    And the response body should be a non-empty array

  @smoke @positive
  Scenario: Create a new user returns 201
    When I send a POST request to "/users" with body:
      """
      {
        "name": "Test User",
        "email": "testuser@osyte.com"
      }
      """
    Then the response status should be 201
    And the response body should contain "email" with value "testuser@osyte.com"

  @positive
  Scenario: Get user by ID returns 200
    Given a user exists with ID 1
    When I send a GET request to "/users/1"
    Then the response status should be 200

  @negative
  Scenario: Get non-existent user returns 404
    When I send a GET request to "/users/99999"
    Then the response status should be 404
