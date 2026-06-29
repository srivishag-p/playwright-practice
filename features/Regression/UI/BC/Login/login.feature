@ui @login
Feature: User Login
  As a BC user
  I want to log in to the application
  So that I can access the system

  Background:
    Given I am on the login page

  @smoke @positive
  Scenario: Successful login with valid credentials
    When I enter username "bc_user" and password "Celcom123#"
    Then I should be redirected to the dashboard

  @negative
  Scenario: Login fails with incorrect password
    When I enter username "bc_user" and password "wrongpassword"
    Then I should see an error message "Incorrect Username/Password"
